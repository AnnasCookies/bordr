import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/** A directory-picker refusal with the HTTP status its route should return. */
export class DirectoryError extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}

function inside(root: string, path: string): boolean {
	return path === root || path.startsWith(root + sep);
}

/**
 * Create one direct child of a directory under the user's home.
 *
 * The parent and result are both checked after symlink resolution. A folder
 * that already exists is returned as-is, which makes “Create and open” safe
 * to retry after a dropped response.
 */
export function createHomeDirectory(
	home: string,
	parent: string | undefined,
	name: unknown
): { path: string; created: boolean } {
	if (typeof name !== 'string') throw new DirectoryError('folder name required');
	const folder = name.trim();
	if (!folder) throw new DirectoryError('folder name required');
	if (folder === '.' || folder === '..' || folder.includes('/') || folder.includes('\\')) {
		throw new DirectoryError('folder name must not contain a path');
	}
	if (folder.startsWith('.')) {
		throw new DirectoryError('hidden folder names are not shown here');
	}
	if (folder.includes('\0')) throw new DirectoryError('folder name is not valid');

	let realHome: string;
	let realParent: string;
	try {
		realHome = realpathSync(home);
		realParent = realpathSync(resolve(parent || home));
	} catch {
		throw new DirectoryError('parent folder does not exist');
	}
	if (!inside(realHome, realParent)) throw new DirectoryError('parent folder is outside home');
	if (!statSync(realParent).isDirectory()) throw new DirectoryError('parent is not a folder');

	const target = resolve(realParent, folder);
	let created = true;
	try {
		mkdirSync(target);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') {
			throw new DirectoryError(`could not create folder: ${(cause as Error).message}`, 500);
		}
		created = false;
	}

	let realTarget: string;
	try {
		realTarget = realpathSync(target);
	} catch {
		throw new DirectoryError('could not open the new folder', 500);
	}
	if (!inside(realHome, realTarget)) throw new DirectoryError('new folder resolves outside home');
	if (!statSync(realTarget).isDirectory())
		throw new DirectoryError('a file already has that name', 409);
	return { path: realTarget, created };
}
