import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

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
		if (!line.includes('"model"') && !line.includes('"modelId"')) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue; // a truncated final line while the agent is mid-write
		}
		if (parsed === null || typeof parsed !== 'object') continue;
		const entry = parsed as {
			isSidechain?: boolean;
			type?: string;
			model?: unknown;
			modelId?: unknown;
			message?: { model?: unknown; role?: string };
		};

		if (entry.isSidechain === true) continue;

		// omp: an entry whose whole purpose is to record the change.
		const changed = entry.modelId ?? entry.model;
		if (
			entry.type === 'model_change' &&
			typeof changed === 'string' &&
			changed &&
			!isPlaceholder(changed)
		) {
			latest = changed;
			continue;
		}
		// Claude Code: on the assistant turn itself.
		if (
			(entry.type === 'assistant' ||
				(entry.type === 'message' && entry.message?.role === 'assistant')) &&
			typeof entry.message?.model === 'string'
		) {
			if (entry.message.model && !isPlaceholder(entry.message.model)) latest = entry.message.model;
		}
	}
	return latest ? shorten(latest) : '';
}

const models = new Map<string, { identity: string; model: string }>();

/** Latest recorded model, including switches outside both display windows. */
export async function latestModel(path: string): Promise<string> {
	const info = await stat(path);
	const identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
	const hit = models.get(path);
	if (hit?.identity === identity) return hit.model;
	let model = '';
	// ponytail: rescan changed files, streaming to bound memory. Index offsets if measured I/O warrants it.
	const stream = createReadStream(path, { encoding: 'utf8' });
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	try {
		for await (const line of lines) model = parseModel(line) || model;
	} finally {
		lines.close();
		stream.destroy();
	}
	// A concurrent append/truncate is retried next poll, never cached as a complete read.
	const after = await stat(path);
	if (
		after.ino === info.ino &&
		after.size === info.size &&
		after.mtimeMs === info.mtimeMs &&
		after.ctimeMs === info.ctimeMs
	) {
		models.set(path, { identity, model });
		if (models.size > 128) models.delete(models.keys().next().value!);
	}
	return model;
}
