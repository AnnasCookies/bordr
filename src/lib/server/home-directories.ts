import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

/** A directory-picker refusal with the HTTP status its route should return. */
export class DirectoryError extends Error {
	constructor(
		message: string,
		readonly status = 400,
		options?: ErrorOptions
	) {
		super(message, options);
	}
}

/** Linux and macOS both cap one path segment at 255 bytes, not characters. */
const MAX_NAME_BYTES = 255;
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\x00-\x1f\x7f]/;

function inside(root: string, path: string): boolean {
	return path === root || path.startsWith(root + sep);
}

/**
 * Whether any folder below `root` on the way to `path` is hidden. The picker
 * never lists a dot folder, so it must not create in one either: a typed
 * `~/.ssh` would otherwise reach a folder the walker keeps out of sight.
 * Only segments below home count, so a home that sits in a dot folder works.
 */
function hiddenBelow(root: string, path: string): boolean {
	return relative(root, path)
		.split(sep)
		.some((segment) => segment.startsWith('.'));
}

/**
 * A real path as the picker shows it. Built from the REAL home, because the
 * paths here are real paths: when home is a symlink, replacing the unresolved
 * home never matched and the phone showed the whole absolute path.
 */
export function homeDisplay(realHome: string, path: string): string {
	if (path === realHome) return '~';
	if (path.startsWith(realHome + sep)) return `~${path.slice(realHome.length)}`;
	return path;
}

/**
 * A mkdir failure as the phone should see it. The raw message names the
 * absolute path, so only the reason goes back; the error stays as `cause`
 * for the server log.
 */
function mkdirRefusal(cause: unknown): DirectoryError {
	switch ((cause as NodeJS.ErrnoException).code) {
		case 'EACCES':
		case 'EPERM':
			return new DirectoryError('permission denied', 403, { cause });
		case 'ENAMETOOLONG':
			return new DirectoryError('folder name is too long', 400, { cause });
		default:
			return new DirectoryError('could not create folder', 500, { cause });
	}
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
	if (CONTROL.test(folder)) throw new DirectoryError('folder name is not valid');
	if (Buffer.byteLength(folder) > MAX_NAME_BYTES) {
		throw new DirectoryError('folder name is too long');
	}

	let realHome: string;
	let realParent: string;
	try {
		realHome = realpathSync(home);
		realParent = realpathSync(resolve(parent || home));
	} catch {
		throw new DirectoryError('parent folder does not exist');
	}
	if (!inside(realHome, realParent)) throw new DirectoryError('parent folder is outside home');
	if (hiddenBelow(realHome, realParent)) throw new DirectoryError('parent folder is hidden');
	if (!statSync(realParent).isDirectory()) throw new DirectoryError('parent is not a folder');

	const target = resolve(realParent, folder);
	let created = true;
	try {
		mkdirSync(target);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirRefusal(cause);
		created = false;
	}

	let realTarget: string;
	try {
		realTarget = realpathSync(target);
	} catch (cause) {
		throw new DirectoryError('could not open the new folder', 500, { cause });
	}
	if (!inside(realHome, realTarget)) throw new DirectoryError('new folder resolves outside home');
	// An existing symlink with a plain name can still lead into a dot folder.
	if (hiddenBelow(realHome, realTarget)) {
		throw new DirectoryError('new folder resolves to a hidden folder');
	}
	if (!statSync(realTarget).isDirectory())
		throw new DirectoryError('a file already has that name', 409);
	return { path: realTarget, created };
}
