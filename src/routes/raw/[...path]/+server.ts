import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { error } from '@sveltejs/kit';
import { MIME, resolveSafe } from '$lib/server/files';
import { allowsArtefact } from '$lib/server/artefact-token';
import type { RequestHandler } from './$types';

const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Serve file BYTES. Browsing moved to the `/f` page; this route is what the
 * viewer, the download link, the share sheet and the sandboxed iframe fetch.
 *
 * Splitting them keeps every confinement rule in one place: a request that
 * reaches this handler has already been through `resolveSafe`, which refuses
 * an escape both lexically and after symlink resolution.
 */
export const GET: RequestHandler = async ({ params, url, request }) => {
	if (!params.path) throw error(404, 'not found');
	const capability = /^~([A-Za-z0-9_-]{43})\/(.+)$/.exec(params.path);
	const requested = capability?.[2] ?? params.path;
	const absolute = resolveSafe(requested);
	if (!absolute) throw error(404, 'not found');

	let stat;
	try {
		stat = statSync(absolute);
	} catch {
		throw error(404, 'not found');
	}
	// Regular files only, not merely "not a directory": a named pipe under a
	// root passes resolveSafe and reports size 0, and the synchronous read
	// below would then block the whole event loop until something wrote to
	// it, stalling every request rather than just this one. Sockets and
	// device nodes are refused for the same reason.
	if (!stat.isFile()) throw error(400, 'not a file');
	if (stat.size > MAX_BYTES) {
		return new Response(
			`This file is ${Math.round(stat.size / 1024 / 1024)}MB; bordr serves up to 50MB.\n`,
			{ status: 413, headers: { 'content-type': 'text/plain; charset=utf-8' } }
		);
	}

	const extension = extname(absolute).slice(1).toLowerCase();
	let type = MIME[extension] ?? 'application/octet-stream';

	// Cross-site alone proves nothing: an unrelated website can load a script
	// too. Only a viewer-issued directory capability permits executable sibling
	// assets in an opaque sandbox; same-origin requests remain inert even with it.
	const site = request.headers.get('sec-fetch-site');
	if (
		(extension === 'js' || extension === 'css') &&
		(site !== 'cross-site' || !allowsArtefact(capability?.[1], absolute))
	) {
		type = 'text/plain; charset=utf-8';
	}

	// Served artifacts render in a SANDBOXED, opaque-origin context: their
	// scripts run (interactive infographics keep working) but they cannot
	// act as bordr's origin — no reaching /api to drive agents.
	const sandboxed = extension === 'html' || extension === 'htm' || extension === 'svg';
	const download = url.searchParams.has('dl');
	return new Response(new Uint8Array(readFileSync(absolute)), {
		headers: {
			'content-type': type,
			'cache-control': 'no-cache',
			'x-content-type-options': 'nosniff',
			'referrer-policy': 'no-referrer',
			...(download
				? {
						'content-disposition': `attachment; filename="${basename(absolute).replace(/[^\x20-\x7e]|"/g, '_')}"`
					}
				: {}),
			...(sandboxed ? { 'content-security-policy': 'sandbox allow-scripts' } : {})
		}
	});
};
