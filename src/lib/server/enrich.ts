import { adapterFor } from './transcript';
import { piSessionEnded } from './transcript/pi';
import { resolveLocalTranscript } from './transcript/resolve';
import { readTranscriptTail } from './transcript/tail';
import { menuFooter, parsePicker, pendingAsk } from './picker';
import { rawAgents, readVisible } from './herdr';
import { parsePane } from './herdr/address';
import { branchesFor, type BranchInfo } from './herdr/branches';
import { connectionFor } from './herdr/connections';
import { extractStatusLines } from './status';
import { piScreenWorking, piTranscriptSettled, reconcilePiStatus } from './pi-status';
import type { AgentSummary } from '$lib/types';
import type { Message } from './transcript/types';

/**
 * Screen reads per pass, issued concurrently. herdr answers one request per
 * connection but serves connections in parallel: fourteen visible reads took
 * 165 ms together and 1.35 s one after another (measured 2026-09-07).
 */
const MAX_READS = 16;

/**
 * How long a pane's last screen reading stands before it is read again.
 *
 * herdr's own `blocked` covers Claude Code's prompts, but pi asks its
 * questions while herdr still says `working`, and other harnesses will
 * differ again. The screen is the one signal every harness shares, so bordr
 * reads it for every pane, not only the ones herdr flags, and treats "a
 * dialog is on screen" as blocked.
 *
 * `seq` is herdr's STATE-change counter: it moves when a status flips, not
 * when the screen repaints, so a dialog can appear under an unchanged seq
 * (pi's does). Active panes are therefore re-read on the interval whatever
 * their seq says. Two seconds is well inside what a person notices on a
 * phone, and a full concurrent sweep costs ~165 ms.
 */
const SCAN_INTERVAL_MS = 2_000;
/**
 * Idle and finished panes grow a dialog too — a slash-command menu opened
 * from the phone — and herdr sends nothing for it: no state change, no
 * event (measured 2026-09-07 with pi's /model). They are re-read on a
 * slower beat, so the list says "needs you" for that pane within a few
 * seconds whichever harness it runs.
 */
const IDLE_SCAN_INTERVAL_MS = 6_000;

interface ScreenReading {
	seq: number;
	at: number;
	picker: AgentSummary['picker'];
	menu: string | null;
	/** Whether Pi's live turn row is still on screen. */
	piWorking: boolean;
	/** The harness's status footer, from the same read. */
	status: string[];
}
const screens = new Map<string, ScreenReading>();

/** For the push reconcile and tests: forget every reading. */
export function resetScreenCache(): void {
	screens.clear();
}

function dueForRead(summary: AgentSummary, now: number): boolean {
	if (summary.status === 'blocked') return true;
	const last = screens.get(summary.paneId);
	if (!last) return true;
	// The fast beat is a floor for everyone: a chatty pane flips state
	// several times a second and must not be read for each flip.
	const age = now - last.at;
	if (age < SCAN_INTERVAL_MS) return false;
	// Active, last seen with a dialog (so a stale "blocked" can never outlive
	// it), or changed state: read again now. Otherwise on the slow beat.
	if (summary.status === 'working' || summary.status === 'unknown') return true;
	if (last.picker !== null || last.seq !== summary.seq) return true;
	return age >= IDLE_SCAN_INTERVAL_MS;
}

/** First line of the preview, capped so a row never wraps. */
const PREVIEW_CHARS = 80;

interface Cached {
	seq: number;
	at: number;
	preview: string;
	idlePreview: string;
	settled: boolean;
	/** A tool-asked question still waiting on the person (codex). */
	ask: AgentSummary['picker'];
}
/**
 * Keyed by pane, invalidated by `seq`.
 *
 * The projector runs on every herdr event, and re-reading every transcript
 * each time costs ~220ms across a real fleet (measured). `seq` is herdr's
 * monotonic per-pane change counter, so a pane that did not change is served
 * from here and never touches the disk.
 */
const cache = new Map<string, Cached>();

function clip(text: string): string {
	const line = text.replace(/\s+/g, ' ').trim();
	return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line;
}

/** The preview the handoff describes, given a parsed transcript. */
export function previewFrom(messages: Message[], status: string): string {
	if (status === 'idle' && messages.length === 0) return 'waiting for a prompt';

	const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
	if (status === 'working') {
		// While working, what it is DOING beats what it last said.
		const lastTool = [...messages].reverse().find((m) => m.tools.length > 0);
		const tool = lastTool?.tools.at(-1);
		if (tool) return clip(`▸ ${tool.name} ${tool.summary}`);
	}
	if (!lastAssistant?.text) return status === 'idle' ? 'waiting for a prompt' : '';
	return status === 'done' ? clip(`✓ ${lastAssistant.text}`) : clip(lastAssistant.text);
}

async function previewFor(summary: AgentSummary, sessionId: string | undefined): Promise<Cached> {
	const hit = cache.get(summary.paneId);
	// seq moves on state changes, not on transcript writes, so a working
	// pane's tail is re-read on the same interval as its screen: that is
	// how a question codex asks mid-turn reaches the list. A pending
	// question is re-read every pass, so a stale "blocked" cannot stick.
	const now = Date.now();
	const fresh =
		hit &&
		hit.seq === summary.seq &&
		!hit.ask &&
		!(summary.status === 'working' && now - hit.at >= SCAN_INTERVAL_MS);
	if (fresh) return hit;

	let preview = '';
	let idlePreview = '';
	let settled = false;
	let ask: AgentSummary['picker'] = null;
	const adapter = sessionId ? adapterFor(summary.agent) : null;
	if (adapter && sessionId) {
		try {
			const path = await resolveLocalTranscript(adapter, summary.paneId, summary.agent, sessionId);
			if (path) {
				const tail = (await readTranscriptTail(path)).text;
				if (summary.agent !== 'omp' || !piSessionEnded(tail)) {
					const messages = adapter.parse(tail);
					preview = previewFrom(messages, summary.status);
					idlePreview = previewFrom(messages, 'idle');
					settled = piTranscriptSettled(messages);
					const pending = pendingAsk(messages);
					if (pending) ask = { question: pending.question, options: pending.options, multi: false };
				}
			}
		} catch {
			// No transcript is not an error — the row falls back to the cwd.
		}
	}
	const entry = { seq: summary.seq, at: now, preview, idlePreview, settled, ask };
	cache.set(summary.paneId, entry);
	// Bounded by the pane count in practice; trim if panes churn a lot.
	if (cache.size > 128) cache.delete(cache.keys().next().value as string);
	return entry;
}

/**
 * Branch and drift for every pane's directory, one call per machine.
 *
 * The list used to skip git entirely, on the grounds that a call per row was
 * too much for a view that repaints every two seconds. It is not a call per
 * row: `branchesFor` takes the whole set at once — a file read plus one git
 * per directory locally, a single ssh for a remote machine — and caches each
 * answer for a minute, so a two-second poll costs nothing between checkouts.
 * The workspace tree already warms the same cache with the same directories.
 *
 * Keyed by machine AND directory: two machines can both have `~/bordr`, and
 * they are not the same repository.
 */
async function gitFor(agents: AgentSummary[]): Promise<Map<string, BranchInfo>> {
	const byMachine = new Map<string, Set<string>>();
	for (const agent of agents) {
		if (!agent.cwd) continue;
		const { machineId } = parsePane(agent.paneId);
		const key = machineId ?? '';
		const dirs = byMachine.get(key) ?? new Set<string>();
		dirs.add(agent.cwd);
		byMachine.set(key, dirs);
	}

	const out = new Map<string, BranchInfo>();
	await Promise.all(
		[...byMachine].map(async ([machineId, dirs]) => {
			// `connectionFor`, NOT `ensureConnection`: this runs on every
			// projection, about every two seconds, and a machine that is down
			// would then be re-dialled on that beat for as long as bordr is
			// open. Listing agents already opens the connection it needs; the
			// branch rides whatever is there and reports nothing otherwise.
			//
			// Nothing is the right answer anyway. A stale branch is worse than
			// no branch: it would say you are on one you have since left, on a
			// box you currently cannot see.
			const machine = machineId ? (connectionFor(machineId)?.machine ?? null) : null;
			if (machineId && !machine) return;
			for (const [cwd, info] of await branchesFor(machine, [...dirs])) {
				out.set(`${machineId}\0${cwd}`, info);
			}
		})
	);
	return out;
}

/**
 * Add the list-only fields: a one-line preview for every pane, the picker for
 * any pane with a dialog on screen so `/` can answer without opening the
 * conversation, and the git state of its directory. A pane showing a dialog is
 * reported as `blocked` whatever herdr said, which is what keeps "needs you"
 * consistent across harnesses.
 *
 * Never throws: an enrichment failure must not cost the caller the agent list
 * itself, which is the thing the screen cannot do without.
 */
export async function enrichAgents(agents: AgentSummary[]): Promise<AgentSummary[]> {
	let raws: Record<string, unknown>[];
	try {
		raws = await rawAgents();
	} catch {
		return agents;
	}
	const sessions = new Map(
		raws.map((a) => [
			a.pane_id as string,
			(a.agent_session as { value?: string } | undefined)?.value
		])
	);
	// Which pane the terminal itself is on — herdr says so in the same list.
	const focused = new Set(raws.filter((a) => a.focused === true).map((a) => a.pane_id as string));

	const [transcripts, git] = await Promise.all([
		Promise.all(agents.map((summary) => previewFor(summary, sessions.get(summary.paneId)))),
		gitFor(agents)
	]);

	const now = Date.now();
	const due = agents
		.filter((a) => dueForRead(a, now))
		// herdr-blocked panes first, then whichever reading is oldest.
		.sort(
			(a, b) =>
				Number(b.status === 'blocked') - Number(a.status === 'blocked') ||
				(screens.get(a.paneId)?.at ?? 0) - (screens.get(b.paneId)?.at ?? 0)
		)
		.slice(0, MAX_READS);
	await Promise.all(
		due.map(async (summary) => {
			try {
				const visible = await readVisible(summary.paneId);
				const picker = parsePicker(visible);
				screens.set(summary.paneId, {
					seq: summary.seq,
					at: now,
					picker: picker
						? { question: picker.question, options: picker.options, multi: picker.multi }
						: null,
					// A menu the person opened is not a blocked agent, so the
					// status stands; the row just says where to drive it.
					menu: picker || summary.status === 'working' ? null : menuFooter(visible),
					piWorking: piScreenWorking(visible),
					// The footer is already on the screen this read fetched, so
					// carrying it costs nothing — model, context and spend on the
					// list without a call per row.
					status: extractStatusLines(visible, 3)
				});
			} catch {
				// Keep the previous reading; a herdr-blocked pane with none
				// renders "waiting on you" with no buttons, as specified.
			}
		})
	);
	for (const paneId of screens.keys()) {
		if (!agents.some((a) => a.paneId === paneId)) screens.delete(paneId);
	}

	return agents.map((summary, i) => {
		const reading = screens.get(summary.paneId);
		const transcript = transcripts[i];
		const picker = reading?.picker ?? transcript.ask;
		const repo = git.get(`${parsePane(summary.paneId).machineId ?? ''}\0${summary.cwd}`);
		const reported = picker && summary.status !== 'blocked' ? 'blocked' : summary.status;
		const status = picker
			? reported
			: reconcilePiStatus(summary.agent, reported, reading?.piWorking ?? true, transcript.settled);
		return {
			...summary,
			branch: repo?.branch ?? '',
			ahead: repo?.ahead ?? 0,
			behind: repo?.behind ?? 0,
			preview:
				status === 'idle' && transcript.settled ? transcript.idlePreview : transcript.preview,
			statusRows: reading?.status ?? [],
			focused: focused.has(summary.paneId),
			picker,
			menu: picker ? null : (reading?.menu ?? null),
			status
		};
	});
}
