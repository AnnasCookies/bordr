import { redactSecrets } from './redact';
import { queueKey, type QueuedPrompt } from '$lib/queue';

/**
 * What the harness says about prompts it has queued.
 *
 * Claude Code writes the whole lifecycle of a queued message into the
 * transcript and bordr was ignoring every word of it:
 *
 *   {"type":"queue-operation","operation":"enqueue","content":"…"}
 *   {"type":"queue-operation","operation":"remove","reason":"absorbed_mid_turn","content":"…"}
 *   {"type":"queue-operation","operation":"dequeue","content":"…"}
 *
 * `enqueue` is "waiting behind the current turn". `dequeue` is the agent
 * taking it at the start of a turn, and `remove` with `absorbed_mid_turn` is
 * the agent taking it WITHOUT waiting — which is the common case on a long
 * turn and the one that read wrongly.
 *
 * The second tick used to be inferred from the terminal screen instead:
 * whether the prompt's first sixty characters could still be found in the
 * visible rows. That is guessing from pixels, and it is wrong in both
 * directions — a message that has scrolled off says "queued" long after the
 * agent replied to it, and any unrelated text that happens to contain those
 * characters says "read" when nothing was. The harness knows. Ask it.
 */

export type { QueuedPrompt };

export function parseQueue(jsonl: string): QueuedPrompt[] {
	/** Preserve occurrences; text alone cannot disambiguate identical pending sends. */
	const latest: QueuedPrompt[] = [];

	for (const line of jsonl.split('\n')) {
		if (!line.trim()) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue; // a truncated final line while the agent is mid-write
		}
		if (parsed === null || typeof parsed !== 'object') continue;
		const entry = parsed as {
			type?: string;
			operation?: string;
			content?: string;
			reason?: string;
			timestamp?: string;
		};
		if (entry.type !== 'queue-operation') continue;
		if (typeof entry.content !== 'string' || !entry.content.trim()) continue;

		const key = queueKey(entry.content);
		if (!key) continue;

		// `remove` covers both the agent taking it and the person deleting it
		// unsent, and only the reason tells them apart. Anything other than an
		// absorb is a prompt that never reached the agent, so it is dropped
		// rather than marked taken — a cancelled message must not show as read.
		if (entry.operation === 'remove' && entry.reason !== 'absorbed_mid_turn') {
			const index = latest.findIndex((q) => queueKey(q.text) === key && !q.taken);
			if (index >= 0) latest.splice(index, 1);
			continue;
		}
		if (
			entry.operation !== 'enqueue' &&
			entry.operation !== 'dequeue' &&
			entry.operation !== 'remove'
		)
			continue;

		const matches = latest.filter((q) => queueKey(q.text) === key && !q.taken);
		const at = entry.timestamp ? Date.parse(entry.timestamp) || 0 : 0;
		if (entry.operation === 'enqueue') {
			latest.push({ text: entry.content, at, taken: false });
		} else if (matches.length === 1) {
			// Keep the enqueue time: a later dequeue does not identify a newer send.
			matches[0].taken = true;
		} else if (matches.length > 1) {
			// Text alone cannot say which identical occurrence was consumed.
			for (const match of matches) match.ambiguous = true;
		} else {
			latest.push({ text: entry.content, at, taken: true, ambiguous: true });
		}
	}

	return latest.map((prompt) => ({ ...prompt, text: redactSecrets(prompt.text) }));
}
