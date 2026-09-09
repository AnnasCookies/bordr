import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { error } from '@sveltejs/kit';
import { MIME, resolveUpload } from '$lib/server/files';
import type { RequestHandler } from './$types';

/** Photos are camera-sized; the upload route already caps what can get here. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Serve one photo sent from the phone, so it renders in the transcript as the
 * photo it was rather than the words "📷 photo".
 *
 * Images only. The uploads directory holds nothing else today, but it is
 * written by a request handler and read by a path out of a transcript, so the
 * type is checked here rather than assumed.
 */
export const GET: RequestHandler = async ({ params }) => {
	const absolute = resolveUpload(params.name);
	if (!absolute) throw error(404, 'not found');

	const type = MIME[extname(absolute).slice(1).toLowerCase()] ?? '';
	if (!type.startsWith('image/')) throw error(415, 'not an image');

	let stat;
	try {
		stat = statSync(absolute);
	} catch {
		throw error(404, 'not found');
	}
	if (stat.size > MAX_BYTES) throw error(413, 'too large');

	return new Response(readFileSync(absolute), {
		headers: {
			'content-type': type,
			'content-length': String(stat.size),
			// Uploads are pruned by age and never rewritten under the same
			// name, so this is safe to hold and saves re-fetching on scroll.
			'cache-control': 'private, max-age=3600',
			'content-disposition': 'inline'
		}
	});
};
