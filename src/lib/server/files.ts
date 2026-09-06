import { env } from '$env/dynamic/private';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, normalize, relative, resolve, sep } from 'node:path';

/**
 * Roots browsable through /f. Configure with BORDR_FILE_ROOTS as
 * comma-separated name:path pairs (e.g. "dev:~/Dev,docs:~/Documents");
 * defaults to ~/Documents/Dev under the name "dev".
 */
function parseRoots(): Record<string, string> {
	const spec = env.BORDR_FILE_ROOTS;
	if (!spec) return { dev: join(homedir(), 'Documents', 'Dev') };
	const roots: Record<string, string> = {};
	for (const pair of spec.split(',')) {
		const colon = pair.indexOf(':');
		if (colon < 1) continue;
		const name = pair.slice(0, colon).trim();
		const path = pair
			.slice(colon + 1)
			.trim()
			.replace(/^~(?=\/|$)/, homedir());
		// resolve() drops a trailing slash, which otherwise defeats the
		// `startsWith(root + sep)` containment check for every file.
		if (name && path.startsWith('/')) roots[name] = resolve(path);
	}
	return roots;
}

/**
 * Only roots that exist. The default is the author's layout, and a root that
 * is merely configured but absent used to list fine and then 404 on the first
 * tap, which on a fresh machine looked like the Files tab was broken.
 */
function existingRoots(roots: Record<string, string>): Record<string, string> {
	const present: Record<string, string> = {};
	for (const [name, path] of Object.entries(roots)) {
		try {
			if (statSync(path).isDirectory()) present[name] = path;
			else console.warn(`bordr: file root "${name}" is not a directory, ignoring: ${path}`);
		} catch {
			console.warn(`bordr: file root "${name}" does not exist, ignoring: ${path}`);
		}
	}
	return present;
}

export const FILE_ROOTS: Record<string, string> = existingRoots(parseRoots());

export const MIME: Record<string, string> = {
	html: 'text/html; charset=utf-8',
	htm: 'text/html; charset=utf-8',
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	pdf: 'application/pdf',
	json: 'application/json; charset=utf-8',
	css: 'text/css; charset=utf-8',
	js: 'text/javascript; charset=utf-8',
	txt: 'text/plain; charset=utf-8',
	// Markdown is served as text so the raw route stays inert; the viewer
	// renders it client-side and decides that from the extension, not this.
	md: 'text/plain; charset=utf-8',
	csv: 'text/csv; charset=utf-8',
	log: 'text/plain; charset=utf-8',
	yaml: 'text/plain; charset=utf-8',
	yml: 'text/plain; charset=utf-8',
	toml: 'text/plain; charset=utf-8'
};

/** How the viewer should render a file, from its extension alone. */
export type ViewerKind = 'markdown' | 'image' | 'pdf' | 'sandboxed' | 'text' | 'binary';

export function viewerKind(name: string): ViewerKind {
	const extension = name.split('.').pop()?.toLowerCase() ?? '';
	if (extension === 'md' || extension === 'markdown') return 'markdown';
	if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) return 'image';
	if (extension === 'pdf') return 'pdf';
	if (['html', 'htm', 'svg'].includes(extension)) return 'sandboxed';
	if (['txt', 'log', 'json', 'csv', 'yaml', 'yml', 'toml', 'css', 'js', 'ts'].includes(extension))
		return 'text';
	return 'binary';
}

/**
 * Map a /f path like "dev/bordr/main/report.html" onto the filesystem,
 * refusing anything that escapes its root — lexically (..) AND after
 * symlink resolution, so a link inside the estate pointing outside it
 * (e.g. at ~/.ssh) cannot be served. Returns null on any escape,
 * unknown root, or missing file.
 */
export function resolveSafe(
	requested: string,
	roots: Record<string, string> = FILE_ROOTS
): string | null {
	const clean = normalize(requested).replaceAll('\\', '/');
	if (clean.includes('..')) return null;
	const [rootKey, ...rest] = clean.split('/').filter(Boolean);
	if (!rootKey) return null;
	const root = roots[rootKey];
	if (!root) return null;
	// Dotfiles are refused at the RESOLVER, not merely hidden from the listing:
	// omitting them from the list while still serving a direct URL is theatre,
	// and `.env` holds the VAPID private key. This also subsumes `..`.
	if (rest.some((segment) => segment.startsWith('.'))) return null;

	const absolute = resolve(root, rest.join('/'));
	if (absolute !== root && !absolute.startsWith(root + sep)) return null;

	// Symlink containment: serve only what REALLY lives under the root.
	let realRoot: string;
	let real: string;
	try {
		realRoot = realpathSync(root);
		real = realpathSync(absolute);
	} catch {
		return null; // missing file — the route 404s
	}
	if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
	// The dotfile rule again, on the RESOLVED path: `ln -s .env notes.txt`
	// inside a root would otherwise serve the thing the rule exists to hide.
	if (
		relative(realRoot, real)
			.split(sep)
			.some((segment) => segment.startsWith('.'))
	) {
		return null;
	}
	return real;
}

export interface Entry {
	name: string;
	dir: boolean;
	size: number;
	mtime: number;
}

export function listDirectory(absolute: string): Entry[] {
	return (
		readdirSync(absolute)
			// Dotfiles are unreachable via resolveSafe, so listing them would only
			// offer rows that 404. node_modules is excluded for noise, not safety.
			.filter((name) => !name.startsWith('.') && name !== 'node_modules')
			.map((name) => {
				try {
					const s = statSync(join(absolute, name));
					return { name, dir: s.isDirectory(), size: s.size, mtime: s.mtimeMs };
				} catch {
					return null;
				}
			})
			.filter((e): e is Entry => e !== null)
			.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
	);
}
