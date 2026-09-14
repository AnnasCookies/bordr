import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
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

/** A file's `src` for an `<img>`, or null when it cannot or should not be shown. */
export function fileSrc(path: string): string | null {
	const media = IMAGE_TYPES[extname(path).toLowerCase()];
	if (!media) return null;

	// A path inside a configured root is servable directly, which streams
	// rather than inlining and costs the payload nothing.
	const served = servableUrl(path);
	if (served) return served;

	// Outside every root — a scratchpad, a temp dir — so the only way to show
	// it is to carry it. Bounded, and silently skipped when too big: a missing
	// picture is better than a payload nobody can load.
	try {
		if (statSync(path).size > MAX_INLINE_BYTES) return null;
		return `data:${media};base64,${readFileSync(path).toString('base64')}`;
	} catch {
		// Pruned, unreadable, or never existed. The tool row still names it.
		return null;
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
