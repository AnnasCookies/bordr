/**
 * A prompt the harness has queued, and how to ask about one.
 *
 * In `$lib` rather than beside the parser because the VIEW needs to ask the
 * question and `$lib/server/*` cannot be imported into the browser. The
 * parser that produces these stays server-side, where the transcript is.
 */

/** One prompt the harness has queued, and whether the agent has taken it. */
export interface QueuedPrompt {
	/** The text as the harness recorded it. */
	text: string;
	/** Epoch ms of the last operation on it. */
	at: number;
	/** Taken by the agent — dequeued at a turn start, or absorbed mid-turn. */
	taken: boolean;
}

/**
 * A prompt matched across records by its text.
 *
 * Whitespace-normalised because the harness records what was typed while the
 * phone holds what was sent, and a trailing newline is not a different
 * message. Nothing is truncated: these are two records of the SAME string, so
 * a prefix match would only add a way for two similar prompts to be confused.
 */
export function queueKey(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/**
 * What the harness says about one prompt, or null when it has said nothing.
 *
 * Null is not "not queued" — it is "this harness does not report a queue", so
 * the caller can fall back rather than claim the message is stuck.
 */
export function queueVerdict(text: string, queue: QueuedPrompt[]): 'queued' | 'taken' | null {
	const key = queueKey(text);
	const match = queue.find((q) => queueKey(q.text) === key);
	if (!match) return null;
	return match.taken ? 'taken' : 'queued';
}
