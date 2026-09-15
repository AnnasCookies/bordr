import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { error, json } from '@sveltejs/kit';
import { HerdrRequestError, promptAgent, rawAgent } from '$lib/server/herdr';
import {
	attachPrompt,
	MAX_ATTACH_BYTES,
	MAX_ATTACH_FILES,
	PHOTO_TYPES,
	storedName
} from '$lib/server/attachments';
import { DATA_DIR } from '$lib/server/state-store';
import type { RequestHandler } from './$types';

const UPLOADS = join(DATA_DIR, 'uploads');
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
 * Accept up to six files plus an optional caption, spool them to disk, and
 * prompt the agent with their paths — every harness here has a file-reading
 * tool, and renders images natively, so nothing has to survive a clipboard or
 * a TUI paste.
 *
 * Any type. The phone's picker offers the camera, the gallery and its files,
 * and the agent is what reads the result. Only a raster photo is ever served
 * back (the uploads route), so an SVG or HTML file stored here cannot run in
 * bordr's origin. The route keeps its old name for the page that calls it.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const form = await request.formData();
	const files = form.getAll('file').filter((f): f is File => f instanceof File);
	const caption = String(form.get('text') ?? '').trim();

	if (files.length === 0) throw error(400, 'file is required');
	if (files.length > MAX_ATTACH_FILES) {
		throw error(400, `at most ${MAX_ATTACH_FILES} files per message`);
	}
	for (const file of files) {
		if (file.size > MAX_ATTACH_BYTES) {
			throw error(413, `${file.name || 'that file'} is too large (15MB cap)`);
		}
	}
	// Check the pane BEFORE spooling: a closed pane must not leave bytes on disk.
	if (!(await rawAgent(params.pane))) throw error(409, 'that agent is no longer running');

	const paths: string[] = [];
	mkdirSync(UPLOADS, { recursive: true, mode: 0o700 });
	pruneOldUploads();
	for (const file of files) {
		const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const path = join(UPLOADS, storedName(file, stamp));
		await writeFile(path, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
		paths.push(path);
	}

	const allPhotos = files.every((file) => file.type in PHOTO_TYPES);
	const text = attachPrompt(paths, allPhotos, caption);

	try {
		await promptAgent(params.pane, text);
	} catch (e) {
		await Promise.all(paths.map((p) => unlink(p).catch(() => undefined)));
		if (e instanceof HerdrRequestError) throw error(409, e.message);
		throw e;
	}
	return json({ ok: true, paths });
};
