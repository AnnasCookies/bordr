import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_TAIL_BYTES, cacheStats, readTranscriptTail } from './tail';

/**
 * Paths whose stat() should report more bytes than the file holds — the
 * state a transcript is in when it is truncated between stat and read.
 */
const inflated = vi.hoisted(() => new Map<string, number>());
vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return {
		...actual,
		stat: async (path: string) => {
			const info = await actual.stat(path);
			const extra = inflated.get(path);
			return extra ? { ...info, size: info.size + extra } : info;
		}
	};
});

const DIR = mkdtempSync(join(tmpdir(), 'bordr-tail-'));

// The eviction case writes ~130MB of fixtures. Without this every run leaked
// that much into /tmp — 46 runs had consumed 4.9GB before anyone noticed.
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

describe('readTranscriptTail', () => {
	it('returns a small file whole', async () => {
		const p = join(DIR, 'small.jsonl');
		writeFileSync(p, '{"a":1}\n{"a":2}\n');
		const { text, partial } = await readTranscriptTail(p);
		expect(partial).toBe(false);
		expect(text).toBe('{"a":1}\n{"a":2}\n');
	});

	it('tails a large file and never returns a partial first line', async () => {
		const p = join(DIR, 'big.jsonl');
		const line = `{"pad":"${'x'.repeat(400)}"}\n`;
		writeFileSync(p, line.repeat(4000)); // ~1.6MB
		const { text, partial } = await readTranscriptTail(p);
		expect(partial).toBe(true);
		expect(text.length).toBeLessThan(1_100_000);
		// Every line must parse — proof the leading fragment was dropped.
		for (const l of text.split('\n')) {
			if (l.trim()) expect(() => JSON.parse(l)).not.toThrow();
		}
	});

	/** pi writes an uploaded photo into the session as one base64 line, ~4 MB. */
	it('widens past a giant line so the messages before it are not lost', async () => {
		const p = join(DIR, 'photo.jsonl');
		const before = '{"role":"user","text":"look at this photo"}\n';
		const giant = `{"role":"toolResult","data":"${'A'.repeat(3 * 1_048_576)}"}\n`;
		const after = '{"role":"assistant","text":"a bowl of tomatoes"}\n';
		writeFileSync(p, before + giant + after);
		const { text, partial } = await readTranscriptTail(p, 1_048_576);
		expect(partial).toBe(false);
		expect(text.startsWith(before)).toBe(true);
		expect(text.endsWith(after)).toBe(true);
	});

	it('serves an unchanged file from cache', async () => {
		const p = join(DIR, 'cached.jsonl');
		writeFileSync(p, '{"a":1}\n');
		const first = await readTranscriptTail(p);
		const second = await readTranscriptTail(p);
		expect(second.text).toBe(first.text);
	});

	it('widens the window on request, returning strictly more of the file', async () => {
		const p = join(DIR, 'window.jsonl');
		const line = `{"pad":"${'x'.repeat(400)}"}\n`;
		writeFileSync(p, line.repeat(8000)); // ~3.2MB
		const narrow = await readTranscriptTail(p, 1_048_576);
		const wide = await readTranscriptTail(p, 4 * 1_048_576);
		expect(narrow.partial).toBe(true);
		expect(wide.partial).toBe(false);
		expect(wide.text.length).toBeGreaterThan(narrow.text.length);
		expect(wide.text.endsWith(narrow.text)).toBe(true);
	});

	/**
	 * The cache was keyed on path alone. Once the window became a parameter that
	 * served a 1MB read out of a 4MB entry — the reader would page back and get
	 * the same screenful, or worse be handed the narrow read after widening.
	 */
	it('does not serve one window size from another size cache entry', async () => {
		const p = join(DIR, 'keyed.jsonl');
		const line = `{"pad":"${'y'.repeat(400)}"}\n`;
		writeFileSync(p, line.repeat(8000));
		const wide = await readTranscriptTail(p, 4 * 1_048_576);
		const narrow = await readTranscriptTail(p, 1_048_576);
		expect(narrow.text.length).toBeLessThan(wide.text.length);
		expect(narrow.partial).toBe(true);
	});

	it('clamps an absurd window rather than allocating it', async () => {
		const p = join(DIR, 'clamp.jsonl');
		writeFileSync(p, '{"a":1}\n');
		const huge = await readTranscriptTail(p, MAX_TAIL_BYTES * 1000);
		expect(huge.text).toBe('{"a":1}\n');
		expect(huge.partial).toBe(false);
	});

	it('never pads the text when the file shrank between stat and read', async () => {
		const p = join(DIR, 'truncated.jsonl');
		writeFileSync(p, '{"a":1}\n');
		inflated.set(p, 64);
		try {
			const { text } = await readTranscriptTail(p);
			expect(text).toBe('{"a":1}\n');
			expect(text).not.toContain('\0');
		} finally {
			inflated.delete(p);
		}
	});

	it('treats a zero or negative window as at least one byte, never a crash', async () => {
		const p = join(DIR, 'tiny.jsonl');
		writeFileSync(p, '{"a":1}\n{"a":2}\n');
		await expect(readTranscriptTail(p, 0)).resolves.toBeDefined();
		await expect(readTranscriptTail(p, -5)).resolves.toBeDefined();
	});

	/**
	 * The cache held 32 entries regardless of size. That was safe only while
	 * every window was 1MB; once the window became a parameter the same bound
	 * allowed 32 x 64MB in a service that runs for weeks.
	 */
	it('evicts by bytes so a few wide windows cannot pin hundreds of megabytes', async () => {
		const line = `{"pad":"${'z'.repeat(1000)}"}\n`;
		const chunk = line.repeat(9000); // ~9MB each
		const paths: string[] = [];
		for (let n = 0; n < 14; n++) {
			const p = join(DIR, `bulk-${n}.jsonl`);
			writeFileSync(p, chunk);
			paths.push(p);
		}
		for (const p of paths) await readTranscriptTail(p, MAX_TAIL_BYTES);

		// Every file is still readable and correct after eviction pressure.
		const last = await readTranscriptTail(paths.at(-1) as string, MAX_TAIL_BYTES);
		expect(last.text.length).toBeGreaterThan(8_000_000);
		expect(last.partial).toBe(false);

		// 14 x ~9MB is ~126MB. The old bound was 32 ENTRIES, so it would have
		// held every one of them; the byte budget must have evicted instead.
		const { entries, bytes } = cacheStats();
		expect(bytes).toBeLessThanOrEqual(96 * 1_048_576);
		expect(entries).toBeLessThan(14);
	});
});
