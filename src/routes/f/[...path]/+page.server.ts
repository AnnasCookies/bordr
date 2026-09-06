import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { error } from '@sveltejs/kit';
import { FILE_ROOTS, listDirectory, MIME, resolveSafe, viewerKind } from '$lib/server/files';
import type { ViewerKind } from '$lib/server/files';
import type { PageServerLoad } from './$types';

/** Above this, the viewer refuses to render inline and offers the file instead. */
const INLINE_LIMIT = 20 * 1024 * 1024;
/**
 * The viewer only ever renders this much of a text file (the page reads the
 * same amount), so an extensionless file at or under it is worth trying as
 * text; a larger one is more likely a compiled binary that happens to lack a
 * suffix.
 */
const TEXT_HEAD_BYTES = 1024 * 1024;

/**
 * LICENSE, Makefile, Dockerfile: no extension, and "no inline preview" for
 * them was wrong far more often than right.
 */
function kindFor(name: string, size: number): ViewerKind {
	const kind = viewerKind(name);
	if (kind === 'binary' && !name.includes('.') && size <= TEXT_HEAD_BYTES) return 'text';
	return kind;
}

export interface DirEntry {
	name: string;
	dir: boolean;
	size: number;
	mtime: number;
	kind: ViewerKind;
}

export const load: PageServerLoad = async ({ params }) => {
	const requested = params.path ?? '';

	// The bare /f lists the configured roots; there is no filesystem path yet.
	if (!requested) {
		return {
			mode: 'roots' as const,
			path: '',
			roots: Object.keys(FILE_ROOTS)
		};
	}

	const absolute = resolveSafe(requested);
	if (!absolute) throw error(404, 'not found');

	let stat;
	try {
		stat = statSync(absolute);
	} catch {
		throw error(404, 'not found');
	}

	if (stat.isDirectory()) {
		const entries: DirEntry[] = listDirectory(absolute).map((e) => {
			let mtime = 0;
			try {
				mtime = statSync(`${absolute}/${e.name}`).mtimeMs;
			} catch {
				// A file that vanished between listing and stat still lists.
			}
			return { name: e.name, dir: e.dir, size: e.size, mtime, kind: kindFor(e.name, e.size) };
		});
		return {
			mode: 'directory' as const,
			path: requested,
			roots: Object.keys(FILE_ROOTS),
			entries
		};
	}

	const extension = basename(absolute).split('.').pop()?.toLowerCase() ?? '';
	const kind = kindFor(basename(absolute), stat.size);
	return {
		mode: 'file' as const,
		path: requested,
		roots: Object.keys(FILE_ROOTS),
		name: basename(absolute),
		size: stat.size,
		mtime: stat.mtimeMs,
		mime: MIME[extension] ?? 'application/octet-stream',
		// Refusing to render a huge file inline is not a failure — Download and
		// Share are the point for anything this size.
		kind: stat.size > INLINE_LIMIT ? ('binary' as ViewerKind) : kind,
		/** Sibling files of the same kind, so an image viewer can page. */
		siblings:
			kind === 'image'
				? listDirectory(absolute.slice(0, absolute.lastIndexOf('/')))
						.filter((e) => !e.dir && viewerKind(e.name) === 'image')
						.map((e) => e.name)
				: []
	};
};
