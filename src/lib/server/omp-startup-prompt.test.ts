import { describe, expect, it } from 'vitest';
import startupPromptExtension, { encodeOmpStartupPrompt } from './omp-startup-prompt';

type InputHandler = (event: {
	text: string;
	source: string;
}) => Promise<{ handled: true } | undefined>;

function extensionHarness() {
	let handler: InputHandler | undefined;
	const sent: string[] = [];
	startupPromptExtension({
		on(event, registered) {
			expect(event).toBe('input');
			handler = registered;
		},
		async sendUserMessage(text) {
			sent.push(text);
		}
	});
	if (!handler) throw new Error('extension did not register its input handler');
	return { handler, sent };
}

describe('OMP startup prompt extension', () => {
	it('submits the exact decoded prompt through the OMP message API', async () => {
		const prompt = '  first line\nsecond line  ';
		const { handler, sent } = extensionHarness();

		await expect(
			handler({ text: encodeOmpStartupPrompt(prompt), source: 'interactive' })
		).resolves.toEqual({ handled: true });
		expect(sent).toEqual([prompt]);
	});

	it('ignores ordinary input, malformed markers, and extension-generated input', async () => {
		const { handler, sent } = extensionHarness();
		const marker = encodeOmpStartupPrompt('do not recurse');

		await expect(
			handler({ text: 'ordinary prompt', source: 'interactive' })
		).resolves.toBeUndefined();
		await expect(
			handler({ text: '__BORDR_INITIAL_PROMPT_V1__:not+base64', source: 'interactive' })
		).resolves.toBeUndefined();
		await expect(handler({ text: marker, source: 'extension' })).resolves.toBeUndefined();
		expect(sent).toEqual([]);
	});
});
