import { describe, expect, it, vi } from 'vitest';
import { commandReceipt, RECEIPT_DEADLINE_MS } from './command-receipt';

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

	it('confirms reload only after Pi progress appears and a positive success row replaces it', async () => {
		const read = screens([
			'/reload',
			'Reloading keybindings, extensions, skills, prompts, themes, and context files...',
			'Reloading keybindings, extensions, skills, prompts, themes, and context files...',
			'Reloaded keybindings, extensions, skills, prompts, themes, and context files'
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

it('never confirms disappearance or a visible failure', async () => {
	const progress =
		'Reloading keybindings, extensions, skills, prompts, themes, and context files...';
	for (const after of ['Pi ready', 'Reload failed: fixture']) {
		expect((await commandReceipt('/reload', screens([progress, after]), noPause))?.outcome).toBe(
			'accepted'
		);
	}
});
it('bounds a hung observation by the total elapsed deadline', async () => {
	vi.useFakeTimers();
	try {
		const result = commandReceipt('/reload', () => new Promise(() => {}));
		await vi.advanceTimersByTimeAsync(RECEIPT_DEADLINE_MS);
		expect((await result)?.outcome).toBe('accepted');
	} finally {
		vi.useRealTimers();
	}
});
