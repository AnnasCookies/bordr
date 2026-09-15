import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { basename, extname, isAbsolute } from 'node:path';
import { servableUrl } from '../files';
import type { Adapter, Block, Message } from './types';

/**
 * Show what `SendUserFile` actually sent, instead of the name of the tool.
 *
 * The harness delivers a file to the phone and writes a tool call for it; the
 * transcript then rendered that as a fold saying "SendUserFile" with a list of
 * paths in it — the one thing the reader cannot do anything with. The files
 * were right there on disk the whole time.
 *
 * Only images are inlined. A PDF or a zip has nothing to show in a message and
 * its row already says which file it was.
 *
 * The paths are agent-written text, and this reads them off bordr's own disk
 * with none of the Files tab's confinement — so what may be read is narrowed
 * here instead: an absolute path with no `.` or `..` segment, whose REAL file
 * (after symlinks) is a regular, non-hidden file with an image extension. And
 * never for a transcript fetched from another machine, whose paths name
 * files on THAT machine; see `adapterFor`.
 */

const IMAGE_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml'
};

/**
 * The biggest file worth turning into a `data:` URL, in bytes.
 *
 * ponytail: a flat cap and the bytes ride in the JSON payload, same bargain as
 * the images a tool returns. A file inside a configured root never reaches
 * this — it gets a real URL and streams. The upgrade, if these ever need to be
 * bigger, is the same one: write to BORDR_DATA_DIR and serve by content hash.
 */
const MAX_INLINE_BYTES = 2_000_000;

/** `O_NOFOLLOW` is POSIX; where it does not exist the realpath check stands alone. */
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

/** A file's `src` for an `<img>`, or null when it cannot or should not be shown. */
export function fileSrc(path: string): string | null {
	// Refused outright rather than normalised, as `resolveUpload` does: an
	// agent has no reason to send `/a/../b.png`, and normalising is how a
	// check and a read end up looking at different files.
	if (!isAbsolute(path)) return null;
	if (path.split(/[\\/]/).some((segment) => segment === '.' || segment === '..')) return null;
	// Cheap reject before touching the disk: most sent files are not images.
	if (!IMAGE_TYPES[extname(path).toLowerCase()]) return null;

	let real: string;
	try {
		real = realpathSync(path);
	} catch {
		// Pruned, unreadable, or never existed. The tool row still names it.
		return null;
	}
	// The extension that counts is the real file's. A link named `x.png`
	// pointing at a private key otherwise passed the name check and was read
	// and shipped to the phone as a "picture".
	const media = IMAGE_TYPES[extname(real).toLowerCase()];
	if (!media) return null;
	// The Files tab's dotfile rule, on the name that is actually read. Applied
	// to the file and not to every directory above it (DECISION: agents
	// routinely work under `.claude/worktrees/…`, and a picture sent from one
	// is an ordinary picture).
	if (basename(real).startsWith('.')) return null;

	// A path inside a configured root is servable directly, which streams
	// rather than inlining and costs the payload nothing.
	const served = servableUrl(real);
	if (served) return served;

	// Outside every root — a scratchpad, a temp dir — so the only way to show
	// it is to carry it. Bounded, and skipped when too big: a missing picture
	// is better than a payload nobody can load.
	let fd: number;
	try {
		// NOFOLLOW so the last component cannot be swapped for a link between
		// the realpath above and this open.
		fd = openSync(real, constants.O_RDONLY | NO_FOLLOW);
	} catch {
		return null;
	}
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.size > MAX_INLINE_BYTES) return null;
		return `data:${media};base64,${readFileSync(fd).toString('base64')}`;
	} catch {
		// Removed or unreadable between the open and the read.
		return null;
	} finally {
		closeSync(fd);
	}
}

/** The file paths a SendUserFile call was given. */
function sentPaths(block: Block): string[] {
	if (block.kind !== 'tool' || block.name !== 'SendUserFile') return [];
	const input = (block as { input?: unknown }).input;
	if (!input || typeof input !== 'object') return [];
	const files = (input as { files?: unknown }).files;
	if (!Array.isArray(files)) return [];
	return files.filter((f): f is string => typeof f === 'string');
}

export function withSentFiles(adapter: Adapter): Adapter {
	return {
		resolve: (sessionId) => adapter.resolve(sessionId),
		parse(jsonl: string): Message[] {
			return adapter.parse(jsonl).map((message) => {
				if (!message.blocks?.some((b) => sentPaths(b).length > 0)) return message;
				const blocks: Block[] = [];
				for (const block of message.blocks) {
					blocks.push(block);
					// After the tool row, not instead of it: the row says which
					// file and whether it landed, and that is still worth having.
					for (const path of sentPaths(block)) {
						const src = fileSrc(path);
						if (src) blocks.push({ kind: 'image', src, caption: '' });
					}
				}
				return { ...message, blocks };
			});
		}
	};
}
