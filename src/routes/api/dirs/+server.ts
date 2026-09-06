import { readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { json } from '@sveltejs/kit';
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
		display: absolute.replace(HOME, '~'),
		parent: absolute === realHome ? null : join(absolute, '..'),
		dirs
	});
};
