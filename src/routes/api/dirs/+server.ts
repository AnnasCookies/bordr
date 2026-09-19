import { readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { json } from '@sveltejs/kit';
import { createHomeDirectory, DirectoryError, homeDisplay } from '$lib/server/home-directories';
import type { RequestHandler } from './$types';

const HOME = homedir();

/**
 * Directory listing for the new-agent picker.
 *
 * Typing a case-sensitive absolute path on a phone keyboard is miserable,
 * so the picker walks instead. Confined to $HOME after symlink resolution —
 * the same containment rule the /f browser uses.
 */
export const GET: RequestHandler = async ({ url }) => {
	const requested = url.searchParams.get('path') || HOME;
	const expanded = requested.replace(/^~(?=\/|$)/, HOME);

	let absolute: string;
	try {
		absolute = realpathSync(resolve(expanded));
	} catch {
		return json({ path: requested, error: 'no such directory', dirs: [], parent: null });
	}
	const realHome = realpathSync(HOME);
	if (absolute !== realHome && !absolute.startsWith(realHome + sep)) {
		return json({ path: requested, error: 'outside home', dirs: [], parent: null });
	}
	if (!statSync(absolute).isDirectory()) {
		return json({ path: requested, error: 'not a directory', dirs: [], parent: null });
	}

	let dirs: string[];
	try {
		dirs = readdirSync(absolute, { withFileTypes: true })
			.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
			.map((e) => e.name)
			.sort((a, b) => a.localeCompare(b))
			.slice(0, 300);
	} catch {
		return json({ path: absolute, error: 'not readable', dirs: [], parent: null });
	}

	return json({
		path: absolute,
		display: homeDisplay(realHome, absolute),
		parent: absolute === realHome ? null : join(absolute, '..'),
		dirs
	});
};

/** Create a child folder and return it so the picker can open it straight away. */
export const POST: RequestHandler = async ({ request }) => {
	let body: { parent?: unknown; name?: unknown };
	try {
		body = (await request.json()) as { parent?: unknown; name?: unknown };
	} catch {
		return json({ message: 'request must be JSON' }, { status: 400 });
	}
	if (typeof body !== 'object' || body === null) {
		return json({ message: 'request must be an object' }, { status: 400 });
	}
	if (body.parent !== undefined && typeof body.parent !== 'string') {
		return json({ message: 'parent folder must be a path' }, { status: 400 });
	}
	try {
		const parent = body.parent?.replace(/^~(?=\/|$)/, HOME);
		const result = createHomeDirectory(HOME, parent, body.name);
		return json({ ...result, display: homeDisplay(realpathSync(HOME), result.path) });
	} catch (cause) {
		// The phone gets a reason without a path; the log keeps the real error.
		if (cause instanceof DirectoryError) {
			if (cause.status >= 500) console.error('POST /api/dirs:', cause.cause ?? cause);
			return json({ message: cause.message }, { status: cause.status });
		}
		console.error('POST /api/dirs:', cause);
		return json({ message: 'could not create folder' }, { status: 500 });
	}
};
