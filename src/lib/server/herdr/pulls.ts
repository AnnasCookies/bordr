import { execFile } from 'node:child_process';
import type { Machine } from './machines';

/**
 * The pull request a branch is on, and whether its checks are green.
 *
 * The branch is already in the header, and the branch is the question you ask
 * on the way to the real one: is it up, and did it pass. Both answers live on
 * GitHub, and `gh` is already on the machine and already authenticated, so
 * this reads them rather than making you leave the app to find out.
 */

/**
 * What every check adds up to.
 *
 *   passing  everything that ran, passed
 *   failing  something failed — the one state worth interrupting for
 *   pending  something is still running, or queued
 *   none     the pull request has no checks at all
 */
export type Checks = 'passing' | 'failing' | 'pending' | 'none';

export interface Pull {
	number: number;
	/** OPEN, MERGED or CLOSED, as GitHub spells it. */
	state: string;
	url: string;
	checks: Checks;
	/** True while the pull request is a draft, which changes what green means. */
	draft: boolean;
}

/**
 * A rollup entry is one of two shapes and they do not agree with each other.
 *
 * A `CheckRun` (GitHub Actions) reports a `status` and, once it is COMPLETED,
 * a `conclusion`. A `StatusContext` — the older commit-status API, which is
 * what most third-party CI still posts — has neither, only a `state`. Reading
 * just one of them silently calls half the world's CI "no checks".
 */
interface RollupEntry {
	status?: string;
	conclusion?: string;
	state?: string;
	/** A CheckRun's job name. */
	name?: string;
	/** A CheckRun's workflow, which is what makes two jobs called `gate` different. */
	workflowName?: string;
	/** A StatusContext's name for itself. */
	context?: string;
	startedAt?: string;
	completedAt?: string;
}

/**
 * When a run happened, for ordering reruns of one check.
 *
 * GitHub fills an unset timestamp with `0001-01-01T00:00:00Z` rather than
 * leaving it out, so anything before the epoch counts as unset too.
 */
function when(entry: RollupEntry): number {
	for (const stamp of [entry.startedAt, entry.completedAt]) {
		const at = stamp ? Date.parse(stamp) : NaN;
		if (Number.isFinite(at) && at > 0) return at;
	}
	return -Infinity;
}

/**
 * One entry per check: its latest run.
 *
 * The rollup lists every run on the head commit, superseded ones included.
 * Pushing twice in quick succession cancels the first CI run, and `gh pr view`
 * for this very repository returned that CANCELLED `CI / gate` beside the
 * SUCCESS run that replaced it — so a green pull request showed a red cross.
 * What a check says NOW is its latest run; the older ones are history.
 *
 * An entry with no name at all cannot be matched to a rerun, so it is kept
 * as its own check rather than guessed at.
 */
export function latestRuns(entries: readonly RollupEntry[]): RollupEntry[] {
	const latest = new Map<string, { entry: RollupEntry; at: number }>();
	entries.forEach((entry, index) => {
		const label = entry.name ?? entry.context;
		const unresolved =
			when(entry) === -Infinity &&
			((Boolean(entry.status) && entry.status?.toUpperCase() !== 'COMPLETED') ||
				entry.state?.toUpperCase() === 'PENDING');
		const key =
			label === undefined || unresolved ? `#${index}` : `${entry.workflowName ?? ''}\0${label}`;
		const at = when(entry);
		const held = latest.get(key);
		// `>=` so that, with no usable timestamps, the later listing wins.
		if (!held || at >= held.at) latest.set(key, { entry, at });
	});
	return [...latest.values()].map(({ entry }) => entry);
}

const BAD = new Set([
	'FAILURE',
	'ERROR',
	'TIMED_OUT',
	'CANCELLED',
	'STARTUP_FAILURE',
	'ACTION_REQUIRED'
]);
// NEUTRAL and SKIPPED are not failures: a skipped job is a job that correctly
// decided it had nothing to do, and calling that red would make every
// path-filtered workflow look broken.
const GOOD = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/**
 * Every check as one word, worst-first.
 *
 * Failing beats pending beats passing: a run with one red job and nine still
 * going is a run you already know about, and showing it as "pending" would
 * hide the only part worth acting on.
 */
export function rollup(entries: readonly RollupEntry[]): Checks {
	if (entries.length === 0) return 'none';
	let pending = false;
	for (const entry of latestRuns(entries)) {
		const verdict = (entry.conclusion || entry.state || '').toUpperCase();
		if (BAD.has(verdict)) return 'failing';
		// A CheckRun that has not completed has no conclusion yet; a
		// StatusContext says PENDING outright.
		if (verdict === 'PENDING' || (entry.status && entry.status.toUpperCase() !== 'COMPLETED')) {
			pending = true;
		} else if (!GOOD.has(verdict)) {
			// An unknown verdict is not a pass. Treating it as one is how a new
			// GitHub conclusion would quietly turn red into green.
			pending = true;
		}
	}
	return pending ? 'pending' : 'passing';
}

/** `gh pr view --json` output, which is an object or nothing at all. */
export function parsePull(stdout: string): Pull | null {
	const text = stdout.trim();
	if (!text) return null;
	let raw: {
		number?: number;
		state?: string;
		url?: string;
		isDraft?: boolean;
		statusCheckRollup?: RollupEntry[] | null;
	};
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof raw.number !== 'number') return null;
	return {
		number: raw.number,
		state: raw.state ?? '',
		url: raw.url ?? '',
		// Null, not just absent: gh sends null for a pull request whose head
		// commit has no checks.
		checks: rollup(raw.statusCheckRollup ?? []),
		draft: raw.isDraft === true
	};
}

const FIELDS = 'number,state,url,isDraft,statusCheckRollup';

function ghPull(cwd: string, branch: string): Promise<Pull | null> {
	return new Promise((resolve) => {
		execFile(
			'gh',
			['pr', 'view', branch, '--json', FIELDS],
			// Long enough for a cold API call, short enough that a hung gh does
			// not hold a cache entry open forever.
			{ cwd, timeout: 8_000, maxBuffer: 4 * 1024 * 1024 },
			(error, stdout) => {
				// Every failure is the same answer: no pull request to show. gh
				// exits non-zero for a branch without one, for a directory that
				// is not a repository, for no auth and for no network, and none
				// of those is worth a different header.
				resolve(error ? null : parsePull(stdout));
			}
		);
	});
}

interface Entry {
	at: number;
	pull: Pull | null;
}

const cache = new Map<string, Entry>();
const inflight = new Set<string>();

/**
 * A minute, which is the shortest useful answer.
 *
 * A run takes minutes, so a fresher number would be the same number at the
 * cost of an API call every poll — and gh is rate-limited per hour, shared
 * with every other thing on this machine that uses it.
 */
const TTL_MS = 60_000;

/**
 * The pull request for a directory, from cache, refreshing in the background.
 *
 * Never awaits the fetch. The pane detail is polled, `gh` takes about half a
 * second on a warm API and eight on a cold one, and a header is not worth
 * making the transcript wait for. So the first read of a directory says
 * nothing and the next one has the answer.
 *
 * ponytail: local panes only. A remote pane's repository is on its own
 * machine, and whether `gh` is installed and authenticated over there is not
 * something this can assume. To lift it, run the same command through
 * `runOn` the way `remoteBranches` does.
 */
export function pullFor(machine: Machine | null, cwd: string, branch: string): Pull | null {
	if (machine || !cwd || !branch) return null;
	const key = `${cwd}\0${branch}`;
	const hit = cache.get(key);
	const fresh = hit && Date.now() - hit.at < TTL_MS;
	if (!fresh && !inflight.has(key)) {
		inflight.add(key);
		void ghPull(cwd, branch)
			.then((pull) => cache.set(key, { at: Date.now(), pull }))
			.finally(() => inflight.delete(key));
	}
	return hit?.pull ?? null;
}
