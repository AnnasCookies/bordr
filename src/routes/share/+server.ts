import { redirect } from '@sveltejs/kit';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { uploadsDir } from '$lib/server/files';
import type { RequestHandler } from './$types';

/** Same ceiling the image route uses; the shrink happens on the phone. */
const MAX_BYTES = 25 * 1024 * 1024;
const EXTENSION: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

/**
 * Android's share sheet, pointed at bordr.
 *
 * A phone keyboard cannot paste an image into a `<textarea>` — Gboard commits
 * images only to fields that accept them through InputConnection, which a
 * plain textarea does not — so Ctrl-V is a desktop answer only. Sharing is
 * the gesture Android actually has for "send this picture to that app".
 *
 * The share sheet cannot know which agent you meant, so the file is stashed
 * and the agents list asks. Stored in the same uploads directory, under the
 * same 0600, and pruned by the same sweep.
 */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
	const text = String(form.get('text') ?? form.get('title') ?? '');

	const dir = uploadsDir();
	mkdirSync(dir, { recursive: true, mode: 0o700 });

	const names: string[] = [];
	for (const file of files.slice(0, 6)) {
		if (file.size > MAX_BYTES) continue;
		const extension = EXTENSION[file.type];
		// Type-checked here as well as on send: this arrives from another app.
		if (!extension) continue;
		const name = `${Date.now()}-${randomBytes(4).toString('hex')}.${extension}`;
		writeFileSync(join(dir, name), Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
		names.push(name);
	}

	// A GET afterwards, so a reload does not re-post the share.
	const query = new URLSearchParams();
	if (names.length) query.set('shared', names.join(','));
	if (text.trim()) query.set('text', text.trim());
	redirect(303, `/?${query}`);
};
