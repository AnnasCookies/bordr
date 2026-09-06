import { open, stat } from 'node:fs/promises';

/** Enough for the ~80 messages first paint renders, ~15x cheaper than the file. */
export const DEFAULT_TAIL_BYTES = 1_048_576;

/**
 * Ceiling on a widened window. Parsing is cheap (81ms for a whole 16MB
 * transcript, measured), so this guards memory and a hostile query string
 * rather than CPU — the largest real transcript on this machine is 38MB.
 */
export const MAX_TAIL_BYTES = 64 * 1_048_576;

/**
 * Cache budget in bytes, not entries.
 *
 * A fixed entry count was safe only while every window was 1MB. Once the
 * window became a parameter the same 32 entries could hold 32 x 64MB = 2GB in
 * a service that runs for weeks. Bound the thing that actually grows.
 */
const MAX_CACHE_BYTES = 96 * 1_048_576;

interface Cached {
	mtimeMs: number;
	size: number;
	text: string;
}
const cache = new Map<string, Cached>();
let cachedBytes = 0;

/** Live cache occupancy — asserted by the tests, useful for diagnostics. */
export function cacheStats(): { entries: number; bytes: number } {
	return { entries: cache.size, bytes: cachedBytes };
}

/** Map iterates in insertion order, so the first key is the oldest entry. */
function remember(key: string, entry: Cached): void {
	const existing = cache.get(key);
	if (existing) cachedBytes -= existing.text.length;
	cache.set(key, entry);
	cachedBytes += entry.text.length;
	while (cachedBytes > MAX_CACHE_BYTES && cache.size > 1) {
		const oldest = cache.keys().next().value as string;
		cachedBytes -= cache.get(oldest)?.text.length ?? 0;
		cache.delete(oldest);
	}
}

export interface TranscriptTail {
	text: string;
	/** True when the window starts past the beginning — earlier messages exist. */
	partial: boolean;
}

/**
 * Read the END of a transcript rather than all of it.
 *
 * Sessions reach tens of megabytes; parsing the lot on every refresh cost
 * ~175ms to display the last 80 messages. Reads the final `maxBytes`, drops
 * the leading partial line, and skips the read when the file has not changed.
 *
 * `maxBytes` widens when the reader pages back through history, so it is part
 * of the cache key — keying on path alone would serve a 1MB read from a 4MB
 * entry (or worse, the reverse) whenever both were requested for one file.
 */
/**
 * A window that holds fewer complete lines than this is widened. pi writes
 * an uploaded photo into its session as base64, one 4 MB line: a 1 MB window
 * opened inside it held the reply and nothing else, and the person's own
 * message vanished behind "Load earlier".
 */
const MIN_LINES = 24;

export async function readTranscriptTail(
	path: string,
	maxBytes: number = DEFAULT_TAIL_BYTES
): Promise<TranscriptTail> {
	const requested = Math.min(Math.max(Math.floor(maxBytes), 1), MAX_TAIL_BYTES);
	const info = await stat(path);
	const key = `${path}:${requested}`;
	const hit = cache.get(key);
	if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) {
		return { text: hit.text, partial: info.size > requested };
	}

	const handle = await open(path, 'r');
	try {
		let window = requested;
		for (;;) {
			const partial = info.size > window;
			const start = partial ? info.size - window : 0;
			const buffer = Buffer.alloc(info.size - start);
			// Read until the buffer is full or the file ends. The size came from
			// stat a moment ago; a file truncated in between returns short, and
			// decoding the whole allocation would append NUL padding to the text.
			let filled = 0;
			while (filled < buffer.length) {
				const { bytesRead } = await handle.read(
					buffer,
					filled,
					buffer.length - filled,
					start + filled
				);
				if (bytesRead === 0) break;
				filled += bytesRead;
			}
			let text = buffer.subarray(0, filled).toString('utf8');
			// A mid-line start would produce one unparseable fragment.
			if (partial) text = text.slice(text.indexOf('\n') + 1);

			const lines = text.split('\n').filter((line) => line.trim()).length;
			if (partial && lines < MIN_LINES && window < MAX_TAIL_BYTES) {
				window = Math.min(window * 2, MAX_TAIL_BYTES);
				continue;
			}
			remember(key, { mtimeMs: info.mtimeMs, size: info.size, text });
			return { text, partial };
		}
	} finally {
		await handle.close();
	}
}
