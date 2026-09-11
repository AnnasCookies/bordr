import { env } from '$env/dynamic/private';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentStatus, AgentSummary } from '$lib/types';
import { HerdrClient, HerdrRequestError } from './client';
import { judgeCompatibility, type Compatibility } from './compat';
import { SubscriptionManager } from './subscriptions';
import { ensureConnection } from './connections';
import { parsePane } from './address';

const DEFAULT_SOCKET = join(homedir(), '.config', 'herdr', 'sessions', 'main', 'herdr.sock');

/** `…/sessions/<name>/herdr.sock` — the directory above the socket names it. */
export function sessionName(socketPath: string): string {
	const parts = socketPath.split('/').filter(Boolean);
	return parts.length >= 2 ? parts[parts.length - 2] : 'unknown';
}
const STATUSES: AgentStatus[] = ['idle', 'working', 'blocked', 'done', 'unknown'];
const RANK: Record<AgentStatus, number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 };

let client: HerdrClient | undefined;
let manager: SubscriptionManager | undefined;
let managerPending: Promise<SubscriptionManager> | undefined;

function socketPath(): string {
	return env.HERDR_SOCKET || DEFAULT_SOCKET;
}

/**
 * The client is stateless per request (connect-per-request), so the
 * singleton never needs reconnection handling.
 *
 * The resolved path is logged once here, where it is first used: a wrong
 * HERDR_SOCKET otherwise surfaces only as "herdr is not reachable" on the
 * phone, with nothing in the server log to say which path was tried.
 */
export function getClient(): HerdrClient {
	if (!client) {
		const path = socketPath();
		console.log(`bordr: herdr socket ${path}`);
		client = new HerdrClient(path);
	}
	return client;
}

/**
 * The client for a pane address: this host, or the machine it names.
 *
 * Throws for a machine that is configured but not reachable, so the caller
 * reports "not reachable" rather than silently answering with local panes.
 */
export async function clientFor(machineId: string): Promise<HerdrClient> {
	if (!machineId) return getClient();
	const connection = await ensureConnection(machineId);
	if (!connection || connection.error) {
		throw new HerdrRequestError(
			'machine_unreachable',
			connection?.error ?? `machine ${machineId} is not reachable`
		);
	}
	return connection.client;
}

/**
 * Memoised on the PROMISE, not just the result: the push watcher and the
 * first SSE request both call this at boot, and without this guard a race
 * builds two managers — two event streams, two listener sets, and every
 * notification sent twice.
 */
export async function getManager(): Promise<SubscriptionManager> {
	if (manager) return manager;
	if (managerPending) return managerPending;

	managerPending = (async () => {
		const created = new SubscriptionManager(getClient(), 15_000, async () =>
			(await listAgents()).map((a) => a.paneId)
		);
		// Subscribe BEFORE the snapshot, then add the pane-scoped
		// subscriptions the snapshot names.
		//
		// herdr 0.9.0 (protocol 22): "New lifecycle event subscriptions now
		// start with live events rather than replaying retained history. API
		// clients should subscribe before taking their initial snapshot to
		// avoid missing changes." (#1270). Listing first left a window in
		// which a status change was neither in the snapshot nor on the stream.
		// The push watcher's reconcile poll would have found it eventually;
		// this stops it going missing in the first place.
		await created.start([]);
		await created.sync((await listAgents()).map((a) => a.paneId));
		manager = created;
		return created;
	})();

	try {
		return await managerPending;
	} catch (e) {
		managerPending = undefined; // a failed boot must be retryable
		throw e;
	} finally {
		if (manager) managerPending = undefined;
	}
}

/**
 * Title precedence: a name the user gave the agent in herdr, then a named
 * workspace (default labels are bare numbers), then whatever terminal title
 * the harness wrote for itself.
 */
export function toSummary(
	raw: Record<string, unknown>,
	workspaceLabels: Map<string, string> = new Map()
): AgentSummary {
	const status = raw.agent_status as AgentStatus;
	const workspaceLabel = workspaceLabels.get(String(raw.workspace_id ?? ''));
	const named =
		(typeof raw.name === 'string' && raw.name) ||
		(workspaceLabel && !/^\d+$/.test(workspaceLabel) ? workspaceLabel : '');
	return {
		paneId: String(raw.pane_id ?? ''),
		agent: String(raw.agent ?? 'unknown'),
		title: named || String(raw.terminal_title_stripped ?? ''),
		status: STATUSES.includes(status) ? status : 'unknown',
		cwd: String(raw.cwd ?? ''),
		seq: Number(raw.state_change_seq ?? 0),
		workspaceId: String(raw.workspace_id ?? ''),
		workspaceLabel: workspaceLabel && !/^\d+$/.test(workspaceLabel) ? workspaceLabel : ''
	};
}

export async function workspaceLabels(): Promise<Map<string, string>> {
	const herdr = getClient();
	try {
		const result = await herdr.request<{ workspaces?: Array<Record<string, unknown>> }>(
			'workspace.list'
		);
		return new Map(
			(result.workspaces ?? []).map((w) => [String(w.workspace_id ?? ''), String(w.label ?? '')])
		);
	} catch {
		return new Map(); // titles degrade to terminal titles, never an error
	}
}

export function sortAgents(agents: AgentSummary[]): AgentSummary[] {
	return [...agents].sort((a, b) => RANK[a.status] - RANK[b.status]);
}

export async function listAgents(): Promise<AgentSummary[]> {
	const herdr = getClient();
	const [result, labels] = await Promise.all([
		herdr.request<{ agents: Record<string, unknown>[] }>('agent.list'),
		workspaceLabels()
	]);
	return sortAgents(result.agents.map((a) => toSummary(a, labels)));
}

/**
 * Every raw agent in one call.
 *
 * `agent.list` returns the whole set, and herdr answers exactly one request per
 * connection — so asking for panes one at a time costs a socket round trip
 * each. Search did that across every pane and spent about a second on 15
 * identical calls.
 */
export async function rawAgents(): Promise<Record<string, unknown>[]> {
	const herdr = getClient();
	const result = await herdr.request<{ agents: Record<string, unknown>[] }>('agent.list');
	return result.agents;
}

export async function rawAgent(address: string): Promise<Record<string, unknown> | null> {
	const { machineId, paneId } = parsePane(address);
	const herdr = await clientFor(machineId);
	const result = await herdr.request<{ agents: Record<string, unknown>[] }>('agent.list');
	const agent = result.agents.find((a) => a.pane_id === paneId);
	return agent ? { ...agent, pane_id: address } : null;
}

/**
 * Any pane, agent or not.
 *
 * `agent.list` omits a pane running a plain shell, so a conversation opened
 * on one 404'd. `pane.list` carries every pane and the same fields where an
 * agent exists, so the caller can treat both alike.
 */
export async function rawPane(address: string): Promise<Record<string, unknown> | null> {
	const { machineId, paneId } = parsePane(address);
	const herdr = await clientFor(machineId);
	const result = await herdr.request<{ panes: Record<string, unknown>[] }>('pane.list');
	const pane = result.panes.find((p) => p.pane_id === paneId);
	// Re-addressed on the way out so callers keep working in bordr's ids.
	return pane ? { ...pane, pane_id: address } : null;
}

export async function readVisible(paneId: string): Promise<string> {
	return readPane(paneId, { source: 'visible' });
}

/**
 * Read a pane's output.
 *
 * `recent_unwrapped` reaches into scrollback (the visible source is one
 * screenful), and `ansi` keeps the colour agent TUIs use semantically.
 *
 * NB: the socket API spells the source `recent_unwrapped`; the CLI spells
 * the same value `recent-unwrapped`. Sending the CLI form gets an
 * "unknown variant" error back from herdr.
 */
export async function readPane(
	address: string,
	opts: { source?: 'visible' | 'recent' | 'recent_unwrapped'; lines?: number; ansi?: boolean } = {}
): Promise<string> {
	const { machineId, paneId } = parsePane(address);
	const herdr = await clientFor(machineId);
	const params = {
		source: opts.source ?? 'visible',
		format: opts.ansi ? 'ansi' : 'text',
		...(opts.lines ? { lines: opts.lines } : {}),
		...(opts.ansi ? { strip_ansi: false } : {})
	};
	try {
		const result = await herdr.request<{ read?: { text?: string } }>('agent.read', {
			target: paneId,
			...params
		});
		return result.read?.text ?? '';
	} catch (e) {
		// `agent.read` resolves an AGENT, so a pane running a plain shell fails
		// with "agent target … not found". The same screen is readable through
		// the pane surface, which is what a shell pane needs.
		if (!(e instanceof HerdrRequestError) && !(e instanceof Error)) throw e;
		const result = await herdr.request<{ read?: { text?: string } }>('pane.read', {
			pane_id: paneId,
			...params
		});
		return result.read?.text ?? '';
	}
}

/**
 * agent.prompt briefly refuses with "not an active named agent" while a
 * pane's agent is (re)registering — seen live with pi. One short retry
 * absorbs the window.
 */
/**
 * Wait for a pane's screen to go still.
 *
 * herdr says `idle` as soon as a harness process is up, which for every one
 * measured (pi, omp, codex, agy, grok, Claude Code after its trust prompt)
 * is seconds before the input box exists. Text typed into that window is
 * eaten or left queued, so ＋ then typing straight away did nothing. The one
 * signal every harness shares is its screen: it keeps repainting while it
 * starts and goes still once it is ready. `before` is a screen that does
 * not count as ready (the shell we started in); `stableMs` is how long it
 * must hold. Returns false if the budget ran out.
 */
export async function settleScreen(
	paneId: string,
	options: { before?: string; budgetMs: number; stableMs: number; pollMs?: number }
): Promise<boolean> {
	const poll = options.pollMs ?? 400;
	const started = Date.now();
	let previous: string | null = null;
	let stableSince = Date.now();
	while (Date.now() - started < options.budgetMs) {
		let now: string;
		try {
			now = await readVisible(paneId);
		} catch {
			await new Promise((r) => setTimeout(r, poll));
			continue;
		}
		if (now === previous) {
			if (now !== options.before && Date.now() - stableSince >= options.stableMs) return true;
		} else {
			previous = now;
			stableSince = Date.now();
		}
		await new Promise((r) => setTimeout(r, poll));
	}
	return false;
}

/**
 * Sent straight away. A settle here (waiting for the screen to hold still
 * before typing) cost every message a second on a still screen and up to
 * eight on a busy one, for a window that only exists in the seconds after
 * a harness starts — and the new-agent route already waits that window out
 * before it hands the pane over.
 */
export async function promptAgent(address: string, text: string): Promise<void> {
	const { machineId, paneId } = parsePane(address);
	const herdr = await clientFor(machineId);
	/**
	 * A leading `!` is a MODE SWITCH, not text.
	 *
	 * `agent.prompt` writes its text under bracketed paste, so a harness
	 * receives `!pwd` as pasted characters and answers it as a question —
	 * measured live: Claude Code replied "…branch feat/rich-transcript,
	 * clean. What next?" instead of running anything. The `!` has to arrive as
	 * a keystroke first, which flips the input into its shell mode (verified
	 * by the prompt row changing from `❯` to a pink `!`), and only then is the
	 * command pasted and submitted.
	 */
	const shell = text.startsWith('!');
	if (shell) {
		await herdr.request('pane.send_text', { pane_id: paneId, text: '!' });
		// The TUI redraws before it will accept the rest.
		await new Promise((r) => setTimeout(r, 250));
		text = text.slice(1);
		// `!` alone has nothing to run; leave the mode open for the next send.
		if (!text.trim()) return;
	}
	try {
		await herdr.request('agent.prompt', { target: paneId, text });
	} catch (e) {
		if (e instanceof HerdrRequestError && e.message.includes('not an active named agent')) {
			await new Promise((r) => setTimeout(r, 2000));
			await herdr.request('agent.prompt', { target: paneId, text });
			return;
		}
		// A shell pane has no agent to prompt; typing the line and pressing
		// enter is the same gesture, and is what the key strip already does.
		if (e instanceof Error && /agent target .* not found/.test(e.message)) {
			await herdr.request('pane.send_text', { pane_id: paneId, text });
			await herdr.request('pane.send_keys', { pane_id: paneId, keys: ['enter'] });
			return;
		}
		throw e;
	}
}

/**
 * Send keys to a pane, wherever it lives.
 *
 * Routes used to hand `params.pane` straight to `agent.send_keys`, which is
 * bordr's address rather than herdr's — a remote pane failed with "agent
 * target tm-dev/w9:p1 not found". Going through here means a route never has
 * to know a machine exists.
 */
/**
 * Put text into the pane's own input line, as typing does.
 *
 * No Enter, no bracketed paste: this is the channel terminal mode types
 * through, so what you type appears where the harness puts what YOU type —
 * its input box — rather than in a separate field bordr owns.
 */
export async function sendText(address: string, text: string): Promise<void> {
	const { machineId, paneId } = parsePane(address);
	const herdr = await clientFor(machineId);
	await herdr.request('pane.send_text', { pane_id: paneId, text });
}

export async function sendKeys(address: string, keys: string[]): Promise<void> {
	const { machineId, paneId } = parsePane(address);
	const herdr = await clientFor(machineId);
	try {
		await herdr.request('agent.send_keys', { target: paneId, keys });
	} catch (e) {
		// `agent.send_keys` resolves an AGENT, so a pane running a plain shell
		// fails with "agent target … not found". The pane surface takes the
		// same keys, which is what a shell pane needs.
		if (!(e instanceof Error)) throw e;
		await herdr.request('pane.send_keys', { pane_id: paneId, keys });
	}
}

/** Cached briefly: every inbox poll would otherwise ping herdr. */
let compatCache: { at: number; value: Compatibility } | undefined;
/** Last level written to the server log, so only the first result and changes appear. */
let loggedLevel: Compatibility['level'] | undefined;

/**
 * The shape every "herdr is down" report uses — checkCompatibility's own
 * failure path and the projector's, so the phone sees one banner whichever
 * call noticed first.
 */
export function unreachableCompatibility(cause: unknown): Compatibility {
	const detail = cause instanceof Error ? cause.message : String(cause);
	return {
		level: 'unreachable',
		version: null,
		protocol: null,
		session: sessionName(socketPath()),
		message: `herdr is not reachable: ${detail}`
	};
}

function logCompatibility(value: Compatibility): void {
	if (value.level === loggedLevel) return;
	loggedLevel = value.level;
	const summary =
		value.message ?? `herdr ${value.version ?? '?'} speaks protocol ${value.protocol ?? '?'}`;
	console.log(`bordr: herdr compatibility ${value.level} — ${summary}`);
}

export async function checkCompatibility(): Promise<Compatibility> {
	if (compatCache && Date.now() - compatCache.at < 30_000) return compatCache.value;
	try {
		const pong = await getClient().request<{ version?: unknown; protocol?: unknown }>('ping');
		const value = { ...judgeCompatibility(pong), session: sessionName(socketPath()) };
		compatCache = { at: Date.now(), value };
		logCompatibility(value);
		return value;
	} catch (e) {
		// Never cached: a cached failure would keep "herdr is not running" on
		// every phone for up to 30 s after herdr came back. A failed ping is
		// cheap (connection refused), so re-asking each time costs nothing.
		compatCache = undefined;
		const value = unreachableCompatibility(e);
		logCompatibility(value);
		return value;
	}
}

export { HerdrRequestError } from './client';
