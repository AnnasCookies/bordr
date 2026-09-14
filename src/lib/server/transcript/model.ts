/**
 * Which model a session is running, from the harness's own record.
 *
 * The first version of this read the terminal's status line, and that was
 * wrong for a reason worth writing down: a status line is the USER'S, not the
 * harness's. omp's is fully configurable — fields, order, glyphs — so parsing
 * it works on the machine it was written against and returns nothing, or
 * something else entirely, on anybody else's.
 *
 * Both harnesses record the model in the transcript, structurally:
 *
 *   Claude Code  every assistant entry carries `message.model`
 *                → "claude-opus-5"
 *   omp          a `model_change` entry each time it is set or switched
 *                → "openai-codex/gpt-5.6-sol"
 *
 * herdr itself has no opinion: its API schema is 123KB and the word "model"
 * does not appear in it once. It manages panes, not what is inside them.
 *
 * The LAST one wins, because `/model` mid-session is a thing people do and the
 * question is always "what is it on now".
 */

/** A vendor prefix is routing, not identity: nobody says "openai-codex/" aloud. */
function shorten(id: string): string {
	const tail = id.slice(id.lastIndexOf('/') + 1);
	return tail || id;
}

/**
 * How much of the START of a transcript is worth reading for a model.
 *
 * omp writes `model_change` when the session begins and then only when the
 * model is switched — so on a long session the one that matters is thousands
 * of lines behind the window the conversation reads, and the tail finds
 * nothing. Claude Code has the opposite shape: every assistant turn carries
 * it, so the tail always has a fresh one.
 *
 * Reading a little of the head covers omp's opening declaration without
 * reading the whole file.
 *
 * ponytail: a switch made in the middle of a long session, with nothing since
 * in the tail, is missed and the opening model is reported. Widen the window
 * or index `model_change` offsets if that ever matters.
 */
export const HEAD_BYTES = 64 * 1024;

/**
 * A model id that is a harness's placeholder, not a model.
 *
 * Claude Code writes `"model": "<synthetic>"` on assistant entries it makes up
 * itself — an interrupted turn, an API error, a notice — and no model answered
 * those. Taken at face value the header read `<synthetic>` until the next real
 * turn. No real model id is wrapped in angle brackets, so the whole shape is
 * refused rather than that one spelling.
 */
function isPlaceholder(model: string): boolean {
	return model.startsWith('<') && model.endsWith('>');
}

export function parseModel(jsonl: string): string {
	let latest = '';
	for (const line of jsonl.split('\n')) {
		if (!line.trim()) continue;
		// Cheap reject: most lines in a transcript name no model at all.
		if (!line.includes('"model"')) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue; // a truncated final line while the agent is mid-write
		}
		if (parsed === null || typeof parsed !== 'object') continue;
		const entry = parsed as { type?: string; model?: unknown; message?: { model?: unknown } };

		// omp: an entry whose whole purpose is to record the change.
		if (entry.type === 'model_change' && typeof entry.model === 'string' && entry.model) {
			latest = entry.model;
			continue;
		}
		// Claude Code: on the assistant turn itself.
		if (entry.type === 'assistant' && typeof entry.message?.model === 'string') {
			if (entry.message.model && !isPlaceholder(entry.message.model)) latest = entry.message.model;
		}
	}
	return latest ? shorten(latest) : '';
}
