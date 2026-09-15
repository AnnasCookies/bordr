import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withPhotoPrompts } from './photo';
import { uploadsDir } from '../files';
import type { Adapter, Message } from './types';

// Svelte's dynamic env otherwise reads the developer .env in Vitest; route it
// to the test project's guarded temp directory before `files.ts` is evaluated.
vi.mock('$env/dynamic/private', () => ({ env: process.env }));

const dataDir = process.env.BORDR_DATA_DIR;
if (!dataDir) throw new Error('BORDR_DATA_DIR is required for photo tests');

const uploads = join(dataDir, 'uploads');
const name = `photo-${process.pid}-${Date.now()}.png`;
const path = join(uploads, name);
mkdirSync(uploads, { recursive: true });
writeFileSync(path, Buffer.from('89504e470d0a1a0a', 'hex'));

afterAll(() => rmSync(path, { force: true }));

function stub(message: Message): Adapter {
	return { resolve: async () => null, parse: () => [message] };
}

describe('withPhotoPrompts', () => {
	it('renders a real upload once without losing message metadata', () => {
		const caption = 'check this';
		const prompt =
			`${caption}[The user attached an image from their phone: ${path} — ` +
			`use your file-reading tool to view it before responding.]\n\n${caption}`;
		const ask = { question: 'Keep it?', options: ['Yes', 'No'] };
		const message: Message = {
			role: 'user',
			text: prompt,
			tools: [],
			blocks: [{ kind: 'text', text: prompt }],
			at: 1_789_200_000_123,
			ask
		};
		expect(uploadsDir()).toBe(uploads);

		const parsed = withPhotoPrompts(stub(message)).parse('')[0];
		expect(parsed).toMatchObject({
			role: 'user',
			text: caption,
			at: message.at,
			ask,
			blocks: [
				{ kind: 'image', src: `/api/uploads/${name}`, caption: '' },
				{ kind: 'text', text: caption }
			]
		});
	});
});
