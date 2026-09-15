import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
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

	/**
	 * The path is agent-written text read off this host's disk. A link named
	 * like a picture used to pass the extension check on its NAME and carry
	 * whatever it pointed at to the phone.
	 */
	it('refuses a link named like an image that points at something else', () => {
		const dir = mkdtempSync(join(tmpdir(), 'bordr-sent-link-'));
		const private_ = join(dir, 'credentials');
		writeFileSync(private_, 'not a picture\n');
		const disguised = join(dir, 'x.png');
		symlinkSync(private_, disguised);
		expect(fileSrc(disguised)).toBeNull();
	});

	it('still shows a link that resolves to a real image', () => {
		const dir = mkdtempSync(join(tmpdir(), 'bordr-sent-link-'));
		const link = join(dir, 'latest.png');
		symlinkSync(png(), link);
		expect(fileSrc(link)?.startsWith('data:image/png;base64,')).toBe(true);
	});

	it('refuses relative paths, dot segments and hidden files', () => {
		const real = png();
		expect(fileSrc('shot.png')).toBeNull();
		expect(
			fileSrc(`${real.slice(0, real.lastIndexOf('/'))}/../${real.split('/').slice(-2).join('/')}`)
		).toBeNull();
		// A real hidden file. The rule reads the name of the file actually
		// opened, so a hidden LINK to a visible picture is still a picture.
		const hidden = join(mkdtempSync(join(tmpdir(), 'bordr-sent-')), '.shot.png');
		copyFileSync(real, hidden);
		expect(fileSrc(hidden)).toBeNull();
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
