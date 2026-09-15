import { resolve } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runOn, shellQuote } from './connections';
import type { Machine } from './machines';

/**
 * The git branch a workspace is on, which herdr shows under its name.
 *
 * Not in the socket API — herdr's own client reads git for this — so bordr
 * does the same, from the workspace's first pane cwd.
 */
function headToBranch(head: string): string {
	const text = head.trim();
	if (text.startsWith('ref: refs/heads/')) return text.slice('ref: refs/heads/'.length);
	// A detached HEAD is a sha; the short form is what a prompt would show.
	return /^[0-9a-f]{7,40}$/.test(text) ? text.slice(0, 7) : '';
}

/** Let Git resolve linked worktrees, gitfiles and repository boundaries. */
export function localBranch(cwd: string): string {
	if (!cwd) return '';
	try {
		const head = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-path', 'HEAD'], {
			encoding: 'utf8',
			timeout: 5000,
			stdio: ['ignore', 'pipe', 'ignore']
		}).trim();
		return headToBranch(readFileSync(resolve(cwd, head), 'utf8'));
	} catch {
		return '';
	}
}

/** A directory's branch and how far it has drifted from its upstream. */
export interface BranchInfo {
	branch: string;
	/** Commits on HEAD the upstream does not have. Zero with no upstream. */
	ahead: number;
	/** Commits on the upstream HEAD does not have. Zero with no upstream. */
	behind: number;
	/** The branch's page on GitHub, or empty when there isn't one to link to. */
	url: string;
}

const NO_BRANCH: BranchInfo = { branch: '', ahead: 0, behind: 0, url: '' };

/**
 * A remote's URL as the branch's page on the web.
 *
 * GitHub only, deliberately. Every forge spells a branch differently —
 * GitLab `/-/tree/`, Gitea `/src/branch/` — and a link built by guessing the
 * shape from a hostname is a link that 404s. Returning nothing means the
 * branch renders as plain text, which is what it did before.
 */
export function branchUrl(remote: string, branch: string): string {
	if (!remote || !branch) return '';
	// Both spellings reduce to host + path: `git@host:owner/repo.git` (scp-like,
	// no scheme, colon separator) and `https://host/owner/repo.git`.
	const parts = /^(?:[\w.+-]+:\/\/)?(?:[^@/]*@)?([^/:]+)[:/](.+?)(?:\.git)?\/?$/.exec(
		remote.trim()
	);
	if (!parts) return '';
	const [, host, path] = parts;
	if (host.toLowerCase() !== 'github.com') return '';
	// A branch name may contain `/`, which stays a separator in the URL, and
	// `#` or `?`, which must not.
	const ref = branch.split('/').map(encodeURIComponent).join('/');
	return `https://github.com/${path}/tree/${ref}`;
}

/**
 * Parse `rev-list --count --left-right @{u}...HEAD`, which prints
 * `behind<TAB>ahead` — left is upstream-only, right is HEAD-only.
 *
 * Empty when the branch has no upstream, which is not an error: a local-only
 * branch has nothing to be ahead OF, so it reports zero rather than nothing.
 */
export function parseCounts(text: string): { ahead: number; behind: number } {
	const [behind, ahead] = text.trim().split(/\s+/).map(Number);
	return Number.isFinite(ahead) && Number.isFinite(behind)
		? { ahead, behind }
		: { ahead: 0, behind: 0 };
}

/**
 * One git command in a directory, or '' if it fails for any reason.
 *
 * `execFile` rather than a shell: the arguments go straight to git, so a
 * directory name needs no quoting and cannot be read as shell syntax.
 */
function gitOut(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve) => {
		const child = execFile('git', ['-C', cwd, ...args], { timeout: 5000 }, (err, stdout) =>
			resolve(err ? '' : stdout.trim())
		);
		child.on('error', () => resolve(''));
	});
}

/**
 * Ahead/behind for one local directory.
 *
 * The branch itself still comes from reading `.git/HEAD`, which costs no
 * process at all — only the counts need git to walk the graph.
 */
async function localCounts(cwd: string): Promise<{ ahead: number; behind: number }> {
	return parseCounts(await gitOut(cwd, ['rev-list', '--count', '--left-right', '@{u}...HEAD']));
}

/**
 * The URL of the remote this branch is measured against.
 *
 * The upstream's remote, and only that — never a fallback to `origin`. Two
 * reasons, both of which bite in this very repository: the counts beside the
 * name are drift from `@{u}`, so another remote would be a link to a
 * different history from the arrows next to it; and bordr's checkout tracks a
 * remote called `fork` while its `origin` is somebody else's copy, where the
 * branch does not exist. No upstream means nothing is known to have been
 * pushed anywhere, so there is no page to link to, and the branch renders as
 * plain text exactly as it did before.
 */
async function localRemote(cwd: string): Promise<string> {
	const upstream = await gitOut(cwd, ['rev-parse', '--abbrev-ref', '@{u}']);
	const remote = upstream.split('/')[0];
	return remote
		? branchUrl(await gitOut(cwd, ['remote', 'get-url', remote]), upstream.slice(remote.length + 1))
		: '';
}

/**
 * What a directory's branch was, and when we last looked.
 *
 * The tree refreshes every few seconds; a branch changes when someone checks
 * one out. Without this, every refresh spawned an ssh for every remote
 * machine — around thirty processes a minute, for ever, to re-read an answer
 * that had not moved.
 */
const cache = new Map<string, { at: number; info: BranchInfo }>();
const TTL_MS = 60_000;

/**
 * Branches for a machine's workspace directories. `machine` is null for this
 * host.
 *
 * Anything still fresh in the cache costs nothing; the rest is resolved in
 * ONE ssh call for a remote machine, or read straight off disk locally.
 */
export async function branchesFor(
	machine: Machine | null,
	cwds: string[]
): Promise<Map<string, BranchInfo>> {
	const out = new Map<string, BranchInfo>();
	const stale: string[] = [];
	const now = Date.now();

	for (const cwd of new Set(cwds.filter(Boolean))) {
		const hit = cache.get(`${machine?.id ?? ''}\0${cwd}`);
		if (hit && now - hit.at < TTL_MS) {
			if (hit.info.branch) out.set(cwd, hit.info);
		} else stale.push(cwd);
	}
	if (stale.length === 0) return out;

	const found = machine ? await remoteBranches(machine, stale) : await localBranches(stale);
	for (const cwd of stale) {
		const info = found.get(cwd) ?? NO_BRANCH;
		// Cached either way: "not a repo" is an answer, and re-proving it every
		// four seconds is the same waste as re-reading a branch.
		cache.set(`${machine?.id ?? ''}\0${cwd}`, { at: now, info });
		if (info.branch) out.set(cwd, info);
	}
	return out;
}

/**
 * Locally the branch is a file read and the counts are one git per directory.
 *
 * Only directories that turned out to BE repositories pay for a process, and
 * the whole set runs at once rather than in series — the stale set is a
 * handful of workspaces at most, bounded by the cache above.
 */
async function localBranches(cwds: string[]): Promise<Map<string, BranchInfo>> {
	const branches = cwds.map((cwd) => [cwd, localBranch(cwd)] as const);
	const state = await Promise.all(
		branches.map(async ([cwd, branch]) =>
			branch
				? {
						...(await localCounts(cwd)),
						url: await localRemote(cwd)
					}
				: { ahead: 0, behind: 0, url: '' }
		)
	);
	return new Map(branches.map(([cwd, branch], i) => [cwd, { branch, ...state[i] }]));
}

/**
 * One line of the remote script: `dir<TAB>branch<TAB>url<TAB>upstream<TAB>behind<TAB>ahead`.
 *
 * The field order is load-bearing. `rev-list` prints its OWN tab between
 * behind and ahead and prints nothing at all when the branch has no upstream,
 * so it has to come last — a field after it would slide into the column meant
 * for `ahead` on every branch that has no upstream to compare against.
 *
 * Null for a line that names no branch: a directory that is not a repository,
 * or one whose HEAD is detached (git reports the literal `HEAD` there, which
 * is not a branch anyone can link to).
 */
export function parseRemoteRow(line: string): { cwd: string; info: BranchInfo } | null {
	const tab = line.indexOf('\t');
	if (tab === -1) return null;
	const [branch, remote, upstream, behind, ahead] = line.slice(tab + 1).split('\t');
	const name = branch.trim();
	if (!name || name === 'HEAD') return null;
	return {
		cwd: line.slice(0, tab),
		info: {
			branch: name,
			...parseCounts(`${behind ?? ''}\t${ahead ?? ''}`),
			url: branchUrl(remote ?? '', upstream ?? '')
		}
	};
}

/**
 * Branches for several directories on a machine, in ONE ssh call.
 *
 * A call per workspace would mean a round trip each, several times a minute.
 * `git -C` is cheap and the whole set fits in one command.
 */
async function remoteBranches(machine: Machine, cwds: string[]): Promise<Map<string, BranchInfo>> {
	const out = new Map<string, BranchInfo>();
	// Each path quoted, so nothing in a directory name is read as shell syntax.
	const quoted = cwds.map(shellQuote).join(' ');
	// A row is dir, local branch, remote URL, upstream branch, behind, ahead.
	//
	// `rev-list` prints its own tab between behind and ahead, so it must come
	// LAST: with no upstream it prints nothing at all, and any field after it
	// would slide into the column meant for `ahead`.
	//
	// `${u%%/*}` is the upstream's remote name, matching localRemote above. It
	// is empty when there is no upstream, and `git remote get-url ''` then
	// fails to an empty field — which is the wanted answer, not a fallback.
	const script = `for d in ${quoted}; do u=$(git -C "$d" rev-parse --abbrev-ref '@{u}' 2>/dev/null); printf '%s\t%s\t%s\t%s\t%s\n' "$d" "$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)" "$(git -C "$d" remote get-url "\${u%%/*}" 2>/dev/null)" "\${u#*/}" "$(git -C "$d" rev-list --count --left-right '@{u}...HEAD' 2>/dev/null)"; done`;
	const text = await runOn(machine, `bash -lc ${shellQuote(script)}`, 65536);
	if (!text) return out;

	for (const line of text.split('\n')) {
		const row = parseRemoteRow(line);
		if (row) out.set(row.cwd, row.info);
	}
	return out;
}
