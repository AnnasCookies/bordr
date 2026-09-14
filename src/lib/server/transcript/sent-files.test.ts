import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileSrc, withSentFiles } from './sent-files';
import type { Adapter, Block, Message } from './types';

/** A one-message adapter, so the decorator is what is under test. */
function stub(blocks: Block[]): Adapter {
	const message: Message = { role: 'assistant', text: '', tools: [], blocks };
	return { resolve: async () => null, parse: () => [message] };
}

function toolBlock(name: string, files: unknown): Block {
	return {
		kind: 'tool',
		name,
		summary: '',
		input: { files },
		result: null,
		diffs: []
	} as Block;
}

/** A real 1x1 PNG on disk, outside any configured file root. */
function png(): string {
	const dir = mkdtempSync(join(tmpdir(), 'bordr-sent-'));
	const path = join(dir, 'shot.png');
	writeFileSync(
		path,
		Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
			'base64'
		)
	);
	return path;
}

describe('fileSrc', () => {
	it('inlines an image that sits outside every file root', () => {
		// A scratchpad path cannot be served, so carrying it is the only way to
		// show it at all.
		const src = fileSrc(png());
		expect(src?.startsWith('data:image/png;base64,')).toBe(true);
	});

	it('says nothing for a file type with nothing to show', () => {
		expect(fileSrc('/tmp/report.pdf')).toBeNull();
		expect(fileSrc('/tmp/data.csv')).toBeNull();
		expect(fileSrc('/tmp/no-extension')).toBeNull();
	});

	it('says nothing for a file that is not there', () => {
		expect(fileSrc('/tmp/definitely-not-here-9271.png')).toBeNull();
	});
});

describe('withSentFiles', () => {
	it('adds the picture AFTER the tool row, never instead of it', () => {
		// The row still says which file it was and whether it landed.
		const blocks = withSentFiles(stub([toolBlock('SendUserFile', [png()])])).parse('')[0].blocks!;
		expect(blocks).toHaveLength(2);
		expect(blocks[0].kind).toBe('tool');
		expect(blocks[1].kind).toBe('image');
	});

	it('leaves every other tool alone', () => {
		const blocks = withSentFiles(stub([toolBlock('Read', [png()])])).parse('')[0].blocks!;
		expect(blocks).toHaveLength(1);
	});

	it('survives input that is not the shape it expects', () => {
		for (const files of [undefined, 'a-string', 42, [1, 2], null]) {
			const blocks = withSentFiles(stub([toolBlock('SendUserFile', files)])).parse('')[0].blocks!;
			expect(blocks, String(files)).toHaveLength(1);
		}
	});

	it('drops only the files it cannot show, keeping the rest', () => {
		const blocks = withSentFiles(
			stub([toolBlock('SendUserFile', ['/tmp/gone.pdf', png(), '/tmp/missing.png'])])
		).parse('')[0].blocks!;
		expect(blocks.filter((b) => b.kind === 'image')).toHaveLength(1);
	});
});
