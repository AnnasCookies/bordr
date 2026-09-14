import { describe, expect, it } from 'vitest';
import { commandReceipt } from './command-receipt';

const noPause = async () => {};

function screens(values: string[]): () => Promise<string> {
	let index = 0;
	return async () => values[Math.min(index++, values.length - 1)] ?? '';
}

describe('commandReceipt', () => {
	it('ignores ordinary prompts and slash-looking paths', async () => {
		expect(await commandReceipt('run the tests', screens([]), noPause)).toBeNull();
		expect(await commandReceipt('//server/share', screens([]), noPause)).toBeNull();
	});

	it('reports a delivered command without claiming it completed', async () => {
		expect(await commandReceipt('/model openai', screens([]), noPause)).toEqual({
			name: 'model',
			outcome: 'accepted',
			message: '✓ /model accepted'
		});
	});

	it('confirms reload only after Pi progress appears and clears', async () => {
		const read = screens([
			'/reload',
			'Reloading keybindings, extensions, skills, prompts, themes, and context files...',
			'Reloading keybindings, extensions, skills, prompts, themes, and context files...',
			'Pi ready'
		]);
		expect(await commandReceipt('/reload', read, noPause)).toEqual({
			name: 'reload',
			outcome: 'confirmed',
			message: '✓ Reload complete'
		});
	});

	it('falls back to sent when reload completion cannot be proved', async () => {
		expect(await commandReceipt('/reload', screens(['Pi ready']), noPause)).toEqual({
			name: 'reload',
			outcome: 'accepted',
			message: '→ /reload sent'
		});
	});
});
