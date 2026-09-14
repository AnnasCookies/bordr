import { error, json } from '@sveltejs/kit';
import { rawAgent, rawPane, readPane, readVisible, toSummary } from '$lib/server/herdr';
import { adapterFor } from '$lib/server/transcript';
import { agentCwd } from '$lib/server/transcript/cwd';
import { parsePane } from '$lib/server/herdr/address';
import { branchesFor } from '$lib/server/herdr/branches';
import { ensureConnection, remoteTranscriptTail } from '$lib/server/herdr/connections';
import { backfillBlocks } from '$lib/server/transcript/types';
import { DEFAULT_TAIL_BYTES, readTranscriptTail } from '$lib/server/transcript/tail';
import { listSubagents } from '$lib/server/transcript/subagents';
import { menuFooter, parsePicker, pendingAsk, suggestionFrom } from '$lib/server/picker';
import { piSessionEnded } from '$lib/server/transcript/pi';
import { resolveLocalTranscript } from '$lib/server/transcript/resolve';
import { extractStatusLines } from '$lib/server/status';
import { extractActivity } from '$lib/server/activity';
import { stripAnsi } from '$lib/ansi';
import { cleanSnapshot } from '$lib/server/snapshot';
import type { AgentDetail, Message } from '$lib/types';
import type { RequestHandler } from './$types';

type Degraded = AgentDetail['degraded'];

/** Rows of screen shipped to the phone; herdr panes here are ~110 rows tall. */
const MAX_SCREEN_ROWS = 160;

/**
 * Transcripts that parsed to nothing, logged once each. A transcript that
 * exists but yields no messages is the signature of a harness format change,
 * and the record types are the fastest clue to what changed.
 */
const reportedEmpty = new Set<string>();

function reportEmpty(path: string, harness: string, text: string): void {
	if (reportedEmpty.has(path)) return;
	reportedEmpty.add(path);
	const types = new Set<string>();
	for (const line of text.split('\n')) {
		if (!line.trim() || types.size >= 8) continue;
		try {
			const record: unknown = JSON.parse(line);
			if (record && typeof record === 'object' && 'type' in record) {
				types.add(String(record.type));
			}
		} catch {
			// a truncated line while the agent is mid-write — not a record type
		}
	}
	console.warn(
		`bordr: ${harness} transcript ${path} parsed to no messages; record types seen: ${[...types].join(', ') || 'none'}`
	);
}

/**
 * The reason each rung fell through, ready to display. Every rung has a
 * different remedy, so the screen must say which one it hit rather than
 * "no adapter" for all of them.
 */
function explain(degraded: Degraded, harness: string, reason?: string): string | null {
	switch (degraded) {
		case 'none':
			return null;
		case 'no-adapter':
			return `No transcript adapter for ${harness} yet; showing the terminal instead.`;
		case 'no-session':
			return (
				reason ??
				`herdr reported no session for this pane, so the transcript cannot be found. Run \`herdr integration install ${harness}\` and restart the agent; showing the terminal instead.`
			);
		case 'stale-session':
			return `Herdr reported an OMP session that has already shut down; showing the live terminal instead of the wrong chat.`;
		case 'unreadable':
			return `The transcript file could not be read (${reason ?? 'unknown error'}); showing the terminal instead.`;
		case 'empty':
			return `The transcript parsed to nothing, which usually means a newer ${harness} format; showing the terminal instead.`;
		default:
			return degraded satisfies never;
	}
}

export const GET: RequestHandler = async ({ params, url }) => {
	// Widened by the reader paging back through history. A junk value must
	// fall back to the default rather than reading zero bytes and rendering
	// an empty conversation.
	const requested = Number(url.searchParams.get('bytes'));
	const windowBytes = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_TAIL_BYTES;

	let raw: Awaited<ReturnType<typeof rawAgent>>;
	let visible: string;
	let summary: ReturnType<typeof toSummary>;
	try {
		raw = await rawAgent(params.pane);
		if (!raw) {
			// A pane with no agent is a shell, not a mistake. It has a screen
			// and takes keys; it has no transcript, status or picker, and the
			// degraded path below already says exactly that. 404ing here made
			// every non-agent pane unopenable.
			const pane = await rawPane(params.pane);
			if (!pane) throw error(404, `no pane ${params.pane}`);
			raw = pane;
		}
		summary = toSummary(raw);
		visible = await readVisible(summary.paneId);
	} catch (e) {
		// A socket error is a plain Error, which SvelteKit renders as a bare
		// "Internal Error"; the phone should see why instead.
		if (e instanceof Error && !('status' in e)) {
			throw error(503, `herdr is not reachable: ${e.message}`);
		}
		throw e;
	}
	// Not gated on status: blocked covers agent questions and permission
	// prompts, but slash-command selectors (/model and friends) sit in
	// status 'unknown' (herdr's model_picker_menu rule) yet are equally
	// tappable. Any picker on screen is answerable.
	const picker = parsePicker(visible);

	/**
	 * Claude Code's ghost prompt, when it is offering one.
	 *
	 * Costs a second screen read, so it is gated hard: only when the agent is
	 * waiting for input and nothing else is on screen. A busy pane repaints
	 * constantly and has no input box to read anyway.
	 *
	 * Read separately rather than switching the main read to ANSI: every other
	 * parser here expects herdr's own plain-text rendering, and re-deriving it
	 * by stripping escapes would risk changing what they see.
	 */
	/**
	 * The same screen again, with its colour.
	 *
	 * Read separately rather than switching the main read to ANSI: every other
	 * parser here expects herdr's own plain-text rendering, and re-deriving it
	 * by stripping escapes would risk changing what they see. One extra read
	 * on a local socket is a few milliseconds.
	 */
	let ansiVisible = '';
	try {
		ansiVisible = await readPane(summary.paneId, { source: 'visible', ansi: true });
	} catch {
		// A failed read costs the colour and the ghost prompt, not the page.
	}

	// Claude Code's ghost prompt, when it is offering one. Only when the agent
	// is waiting for input and nothing else is on screen: a busy pane repaints
	// constantly and has no input box to read anyway.
	let suggestion: string | null = null;
	if (!picker && (summary.status === 'idle' || summary.status === 'done')) {
		suggestion = suggestionFrom(ansiVisible);
	}

	const sessionId = (raw.agent_session as { value?: string } | undefined)?.value;
	const adapter = adapterFor(summary.agent);

	let messages: Message[] = [];
	let degraded: Degraded = 'none';
	let reason: string | undefined;
	let hasMore = false;
	/** Where the agent is working, when its transcript says. '' falls back to the pane. */
	let workingDir = '';
	let subagents: Awaited<ReturnType<typeof listSubagents>> = [];

	if (!adapter) {
		degraded = 'no-adapter';
	} else if (!sessionId) {
		degraded = 'no-session';
	} else {
		// A pane on another machine keeps its transcript on THAT machine, so
		// the file is read over the same SSH connection the forward uses
		// rather than looked for on this disk.
		const { machineId } = parsePane(params.pane);
		if (machineId) {
			const connection = await ensureConnection(machineId);
			const remote = connection
				? await remoteTranscriptTail(connection.machine, summary.agent, sessionId, windowBytes)
				: null;
			if (remote === null) {
				degraded = 'no-session';
				reason = `The transcript for this pane lives on ${connection?.machine.label ?? machineId}; bordr could not read it over ssh. Its screen is shown instead.`;
			} else {
				try {
					if (summary.agent === 'omp' && piSessionEnded(remote)) {
						degraded = 'stale-session';
					} else {
						messages = adapter.parse(remote);
						workingDir = agentCwd(remote);
						hasMore = remote.length >= windowBytes;
						if (messages.length === 0) degraded = 'empty';
					}
				} catch (e) {
					degraded = 'unreadable';
					reason = e instanceof Error ? e.message : String(e);
				}
			}
		} else {
			const path = await resolveLocalTranscript(adapter, summary.paneId, summary.agent, sessionId);
			if (!path) {
				// herdr named a session, so the contract message ("reported no
				// session") would be untrue here — the file is what is missing.
				degraded = 'no-session';
				reason = `herdr reported a session for this pane but its transcript file was not found. Run \`herdr integration install ${summary.agent}\` and restart the agent; showing the terminal instead.`;
			} else {
				// The sub-agents live beside this file, so its path is what finds
				// them. Local branch only: a remote pane's transcript is on that
				// machine and its children are with it.
				subagents = await listSubagents(path);
				try {
					const tail = await readTranscriptTail(path, windowBytes);
					if (summary.agent === 'omp' && piSessionEnded(tail.text)) {
						degraded = 'stale-session';
					} else {
						messages = adapter.parse(tail.text);
						workingDir = agentCwd(tail.text);
						hasMore = tail.partial;
						// A whole transcript that parses to nothing is a format we no
						// longer understand; a partial window with nothing in it is
						// just a window full of tool output, and paging back may help.
						if (messages.length === 0 && !tail.partial) {
							degraded = 'empty';
							reportEmpty(path, summary.agent, tail.text);
						}
					}
				} catch (e) {
					degraded = 'unreadable';
					reason = e instanceof Error ? e.message : String(e);
				}
			}
		}
	}

	if (degraded !== 'none') {
		// Through backfillBlocks like every other message: this path builds a
		// Message by hand rather than through an adapter, and a message with no
		// `blocks` renders as an empty bubble — the snapshot, which is the whole
		// point of the degraded path, vanished.
		messages = [backfillBlocks({ role: 'assistant', text: cleanSnapshot(visible), tools: [] })];
		hasMore = false;
	}

	// The status footer renders in the header for everyone; cleanSnapshot
	// strips it from snapshot bodies so it never shows twice.
	// What the harness says it is doing right now — its verb, elapsed time,
	// tokens and tip. Painted in place on the screen, never written to the
	// transcript, so this is the only place it can come from.
	const activity = extractActivity(visible);

	// OMP extension widgets allow ten logical rows, and each is an ordinary
	// Text component that can wrap into several physical rows. Keep enough for
	// the whole widget plus extension hook statuses at narrow terminal widths.
	const statusLines = extractStatusLines(visible, 32);

	/**
	 * The same lines with their SGR colour, for the header.
	 *
	 * Matched by content rather than re-running the scrape over ANSI: the
	 * extractor's own guards (a leading box-drawing character disqualifies a
	 * line) would never fire against text that starts with an escape
	 * sequence, and box borders would start being reported as status lines.
	 * Falls back to the plain line whenever the match fails.
	 */
	const ansiRows = ansiVisible.split('\n');
	const plainRows = ansiRows.map((row) =>
		stripAnsi(row)
			.trim()
			.replace(/\s{2,}/g, '  ')
	);
	const statusAnsi = statusLines.map((line) => {
		const at = plainRows.indexOf(line);
		return at >= 0 ? ansiRows[at].trim() : line;
	});

	// The pane's screen, for driving a TUI from the keypad: every non-blank
	// row, minus the footer already in the header. A tail of eighteen rows
	// cut Claude Code's /config panel off above the highlighted row, and
	// six of the eighteen were the status footer. Capped at a tall pane.
	const status = new Set(statusLines.map((l) => l.trim()));
	const screenTail = visible
		.split('\n')
		.filter((l) => l.trim() !== '' && !status.has(l.trim().replace(/\s{2,}/g, '  ')))
		.slice(-MAX_SCREEN_ROWS)
		.join('\n');

	// Where the agent actually is, falling back to the pane when its transcript
	// never said — a shell pane has no transcript at all — and the git state of
	// that directory. Read where the pane LIVES: a remote pane's repository is
	// on that machine, not this disk. One directory, and branchesFor caches for
	// a minute, so a poll costs nothing between checkouts.
	const cwd = workingDir || summary.cwd;
	const { machineId: gitMachineId } = parsePane(params.pane);
	const gitMachine = gitMachineId
		? ((await ensureConnection(gitMachineId))?.machine ?? null)
		: null;
	const git =
		gitMachineId && !gitMachine
			? undefined // unreachable machine: no branch is honest, a stale one is not
			: (await branchesFor(gitMachine, [cwd])).get(cwd);

	return json({
		...summary,
		// The agent's directory wins over the pane's for everything the detail
		// view shows; `paneCwd` keeps the shell's, which is what a key sent to
		// the terminal would actually run in.
		cwd,
		paneCwd: summary.cwd,
		branch: git?.branch ?? '',
		ahead: git?.ahead ?? 0,
		behind: git?.behind ?? 0,
		branchUrl: git?.url ?? '',
		messages,
		subagents,
		// OMP options are relative-key modals: without the live highlight,
		// transcript labels cannot be answered safely. Other harnesses here
		// accept an absolute text label and may use the transcript fallback.
		picker: picker ?? (summary.agent === 'omp' ? null : pendingAsk(messages)),
		// No picker, but a menu is open: say so, and where to drive it.
		menu: picker || summary.status === 'working' ? null : menuFooter(visible),
		degraded,
		degradedMessage: explain(degraded, summary.agent, reason),
		activity,
		suggestion,
		screenTail,
		statusLines,
		statusAnsi,
		hasMore
	} satisfies AgentDetail);
};
