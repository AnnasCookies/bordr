import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { error, json } from '@sveltejs/kit';
import { HerdrRequestError, promptAgent, rawAgent } from '$lib/server/herdr';
import { DATA_DIR } from '$lib/server/state-store';
import type { RequestHandler } from './$types';

const UPLOADS = join(DATA_DIR, 'uploads');
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 6;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Nothing else ever deletes an upload, and the agent has read it within
 * seconds of arrival. A week is generous for "I want to look at that again".
 */
function pruneOldUploads(): void {
	let names: string[];
	try {
		names = readdirSync(UPLOADS);
	} catch {
		return;
	}
	const cutoff = Date.now() - KEEP_MS;
	for (const name of names) {
		const path = join(UPLOADS, name);
		try {
			if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
		} catch {
			// Already gone, or not ours to remove; either way not worth failing an upload over.
		}
	}
}

/**
 * Accept one or more photos/screenshots plus an optional caption, spool them
 * to disk, and prompt the agent with their paths — every harness here has a
 * file-reading tool that renders images natively, so nothing has to survive
 * a clipboard or a TUI paste.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const form = await request.formData();
	const files = form.getAll('file').filter((f): f is File => f instanceof File);
	const caption = String(form.get('text') ?? '').trim();

	if (files.length === 0) throw error(400, 'file is required');
	if (files.length > MAX_FILES) throw error(400, `at most ${MAX_FILES} images per message`);
	for (const file of files) {
		if (!ALLOWED_TYPES.has(file.type)) {
			throw error(400, `unsupported type: ${file.type || 'unknown'} (png, jpeg, webp or gif)`);
		}
		if (file.size > MAX_BYTES) throw error(413, `${file.name || 'image'} is too large (15MB cap)`);
	}
	// Check the pane BEFORE spooling: a closed pane must not leave bytes on disk.
	if (!(await rawAgent(params.pane))) throw error(409, 'that agent is no longer running');

	const paths: string[] = [];
	mkdirSync(UPLOADS, { recursive: true, mode: 0o700 });
	pruneOldUploads();
	for (const file of files) {
		const extension = file.type === 'image/png' ? 'png' : file.type.split('/')[1];
		const path = join(
			UPLOADS,
			`${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`
		);
		await writeFile(path, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
		paths.push(path);
	}

	const label =
		paths.length === 1
			? `an image from their phone: ${paths[0]}`
			: `${paths.length} images from their phone:\n${paths.map((p) => `- ${p}`).join('\n')}`;
	const text =
		`[The user attached ${label} — use your file-reading tool to view ${
			paths.length === 1 ? 'it' : 'them'
		} before responding.]` + (caption ? `\n\n${caption}` : '');

	try {
		await promptAgent(params.pane, text);
	} catch (e) {
		await Promise.all(paths.map((p) => unlink(p).catch(() => undefined)));
		if (e instanceof HerdrRequestError) throw error(409, e.message);
		throw e;
	}
	return json({ ok: true, paths });
};
