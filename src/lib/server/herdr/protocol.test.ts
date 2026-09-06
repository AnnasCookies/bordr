import { describe, expect, it } from 'vitest';
import { createDecoder, encode, isError, isEvent } from './protocol';

describe('encode', () => {
	it('appends exactly one newline', () => {
		expect(encode({ id: 'a', method: 'ping', params: {} })).toBe(
			'{"id":"a","method":"ping","params":{}}\n'
		);
	});
});

describe('createDecoder', () => {
	it('decodes one whole frame', () => {
		const decode = createDecoder();
		const frames = decode('{"id":"a","result":{"type":"pong"}}\n');
		expect(frames).toHaveLength(1);
		expect(frames[0]).toEqual({ id: 'a', result: { type: 'pong' } });
	});

	it('reassembles a frame split across chunks', () => {
		const decode = createDecoder();
		expect(decode('{"id":"a","res')).toHaveLength(0);
		const frames = decode('ult":{"type":"pong"}}\n');
		expect(frames).toHaveLength(1);
		expect(frames[0]).toEqual({ id: 'a', result: { type: 'pong' } });
	});

	it('decodes several frames arriving in one chunk', () => {
		const decode = createDecoder();
		const frames = decode('{"id":"a","result":{}}\n{"id":"b","result":{}}\n');
		expect(frames.map((f) => (f as { id: string }).id)).toEqual(['a', 'b']);
	});

	it('ignores blank lines', () => {
		const decode = createDecoder();
		expect(decode('\n\n{"id":"a","result":{}}\n')).toHaveLength(1);
	});
});

describe('frame discrimination', () => {
	it('identifies an event', () => {
		const f = { event: 'pane.updated', data: { type: 'pane_updated' } };
		expect(isEvent(f)).toBe(true);
		expect(isError(f)).toBe(false);
	});

	it('identifies an error', () => {
		const f = { id: 'a', error: { code: 'invalid_request', message: 'bad' } };
		expect(isError(f)).toBe(true);
		expect(isEvent(f)).toBe(false);
	});
});
