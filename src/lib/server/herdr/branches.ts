import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** Walk up for a .git, the way git itself resolves a repository. */
export function localBranch(cwd: string): string {
	let dir = cwd;
	for (let depth = 0; depth < 12 && dir && dir !== '/'; depth++) {
		try {
			const head = readFileSync(join(dir, '.git', 'HEAD'), 'utf8');
			return headToBranch(head);
		} catch {
			// A worktree keeps a .git FILE pointing elsewhere; reading it as a
			// directory fails, so fall through and try the parent.
		}
		dir = dir.slice(0, dir.lastIndexOf('/'));
	}
	return '';
}

/**
 * What a directory's branch was, and when we last looked.
 *
 * The tree refreshes every few seconds; a branch changes when someone checks
 * one out. Without this, every refresh spawned an ssh for every remote
 * machine — around thirty processes a minute, for ever, to re-read an answer
 * that had not moved.
 */
const cache = new Map<string, { at: number; branch: string }>();
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
): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	const stale: string[] = [];
	const now = Date.now();

	for (const cwd of new Set(cwds.filter(Boolean))) {
		const hit = cache.get(`${machine?.id ?? ''}\0${cwd}`);
		if (hit && now - hit.at < TTL_MS) {
			if (hit.branch) out.set(cwd, hit.branch);
		} else stale.push(cwd);
	}
	if (stale.length === 0) return out;

	const found = machine ? await remoteBranches(machine, stale) : localBranches(stale);
	for (const cwd of stale) {
		const branch = found.get(cwd) ?? '';
		// Cached either way: "not a repo" is an answer, and re-proving it every
		// four seconds is the same waste as re-reading a branch.
		cache.set(`${machine?.id ?? ''}\0${cwd}`, { at: now, branch });
		if (branch) out.set(cwd, branch);
	}
	return out;
}

function localBranches(cwds: string[]): Map<string, string> {
	return new Map(cwds.map((cwd) => [cwd, localBranch(cwd)]));
}

/**
 * Branches for several directories on a machine, in ONE ssh call.
 *
 * A call per workspace would mean a round trip each, several times a minute.
 * `git -C` is cheap and the whole set fits in one command.
 */
async function remoteBranches(machine: Machine, cwds: string[]): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	// Each path quoted, so nothing in a directory name is read as shell syntax.
	const quoted = cwds.map(shellQuote).join(' ');
	const script = `for d in ${quoted}; do printf '%s\t%s\n' "$d" "$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)"; done`;
	const text = await runOn(machine, `bash -lc ${shellQuote(script)}`, 65536);
	if (!text) return out;

	for (const line of text.split('\n')) {
		const tab = line.indexOf('\t');
		if (tab === -1) continue;
		const branch = line.slice(tab + 1).trim();
		if (branch && branch !== 'HEAD') out.set(line.slice(0, tab), branch);
	}
	return out;
}
