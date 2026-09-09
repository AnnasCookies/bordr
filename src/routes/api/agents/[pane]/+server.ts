import { error, json } from '@sveltejs/kit';
import { rawAgent, rawPane, readPane, readVisible, toSummary } from '$lib/server/herdr';
import { adapterFor } from '$lib/server/transcript';
import { backfillBlocks } from '$lib/server/transcript/types';
import { DEFAULT_TAIL_BYTES, readTranscriptTail } from '$lib/server/transcript/tail';
import { menuFooter, parsePicker, pendingAsk, suggestionFrom } from '$lib/server/picker';
import { extractStatusLines } from '$lib/server/status';
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

	if (!adapter) {
		degraded = 'no-adapter';
	} else if (!sessionId) {
		degraded = 'no-session';
	} else {
		const path = await adapter.resolve(sessionId);
		if (!path) {
			// herdr named a session, so the contract message ("reported no
			// session") would be untrue here — the file is what is missing.
			degraded = 'no-session';
			reason = `herdr reported a session for this pane but its transcript file was not found. Run \`herdr integration install ${summary.agent}\` and restart the agent; showing the terminal instead.`;
		} else {
			try {
				const tail = await readTranscriptTail(path, windowBytes);
				messages = adapter.parse(tail.text);
				hasMore = tail.partial;
				// A whole transcript that parses to nothing is a format we no
				// longer understand; a partial window with nothing in it is
				// just a window full of tool output, and paging back may help.
				if (messages.length === 0 && !tail.partial) {
					degraded = 'empty';
					reportEmpty(path, summary.agent, tail.text);
				}
			} catch (e) {
				degraded = 'unreadable';
				reason = e instanceof Error ? e.message : String(e);
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
	const statusLines = extractStatusLines(visible);

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

	return json({
		...summary,
		messages,
		// A dialog on screen wins; otherwise a question asked through a tool.
		picker: picker ?? pendingAsk(messages),
		// No picker, but a menu is open: say so, and where to drive it.
		menu: picker || summary.status === 'working' ? null : menuFooter(visible),
		degraded,
		degradedMessage: explain(degraded, summary.agent, reason),
		suggestion,
		screenTail,
		statusLines,
		statusAnsi,
		hasMore
	} satisfies AgentDetail);
};
