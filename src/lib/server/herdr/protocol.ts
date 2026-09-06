import { StringDecoder } from 'node:string_decoder';

export interface HerdrRequest {
	id: string;
	method: string;
	params?: unknown;
}

export interface HerdrSuccess {
	id: string;
	result: { type: string } & Record<string, unknown>;
}

export interface HerdrError {
	id: string;
	error: { code: string; message: string };
}

export interface HerdrEvent {
	event: string;
	data: { type: string } & Record<string, unknown>;
}

export type HerdrFrame = HerdrSuccess | HerdrError | HerdrEvent;

export function isEvent(frame: HerdrFrame): frame is HerdrEvent {
	return 'event' in frame;
}

export function isError(frame: HerdrFrame): frame is HerdrError {
	return 'error' in frame;
}

export function encode(request: HerdrRequest): string {
	return JSON.stringify(request) + '\n';
}

/** A line on the socket that is not JSON — the peer is not herdr. */
export class HerdrFrameError extends Error {
	constructor(line: string) {
		super(`herdr sent a non-JSON frame: ${line.length > 120 ? `${line.slice(0, 120)}…` : line}`);
		this.name = 'HerdrFrameError';
	}
}

/**
 * herdr frames are newline-delimited JSON. A single socket read can deliver a
 * partial frame, several frames, or both — so the decoder keeps a buffer and
 * only emits complete lines.
 *
 * Bytes, not strings, go in: a socket read can also split a multi-byte UTF-8
 * sequence, and decoding each chunk on its own turns the halves into U+FFFD.
 * The StringDecoder carries the dangling bytes over to the next chunk.
 */
export function createDecoder(): (chunk: Buffer | string) => HerdrFrame[] {
	const utf8 = new StringDecoder('utf8');
	let buffer = '';
	return (chunk: Buffer | string): HerdrFrame[] => {
		buffer += typeof chunk === 'string' ? chunk : utf8.write(chunk);
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? '';
		const frames: HerdrFrame[] = [];
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				frames.push(JSON.parse(line) as HerdrFrame);
			} catch {
				// Thrown, not skipped: a socket that talks something other than
				// JSON is the wrong daemon, and the caller must give up on it.
				throw new HerdrFrameError(line);
			}
		}
		return frames;
	};
}
