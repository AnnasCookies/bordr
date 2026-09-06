import { describe, expect, it } from 'vitest';
import { piAdapter } from './pi';

const SESSION = [
	'{"type":"session","version":1}',
	'{"type":"message","message":{"role":"user","content":[{"type":"text","text":"look at the repo"}]}}',
	'{"type":"message","message":{"role":"assistant","content":[{"type":"thinking","thinking":"private"},{"type":"text","text":"On it."},{"type":"toolCall","name":"read","arguments":{"path":"/repo","i":"Listing repo root"}}]}}',
	'{"type":"message","message":{"role":"toolResult","content":[{"type":"text","text":"files..."}]}}',
	'{"type":"custom_message","customType":"x","content":"noise"}',
	'{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"Done."}]}}'
].join('\n');

describe('piAdapter.parse', () => {
	it('keeps user and assistant turns, drops toolResult and custom entries', () => {
		expect(piAdapter.parse(SESSION).map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
	});

	it('summarises tool calls from the intent field', () => {
		const assistant = piAdapter.parse(SESSION)[1];
		expect(assistant.text).toBe('On it.');
		expect(assistant.tools).toEqual([{ name: 'read', summary: 'Listing repo root' }]);
	});

	it('never renders thinking blocks', () => {
		expect(JSON.stringify(piAdapter.parse(SESSION))).not.toContain('private');
	});
});

describe('piAdapter.resolve', () => {
	it('accepts only absolute existing paths', async () => {
		expect(await piAdapter.resolve('not-a-path')).toBeNull();
		expect(await piAdapter.resolve('/no/such/file.jsonl')).toBeNull();
	});
});

describe('pi adapter: hostile lines', () => {
	it('skips a bare null or scalar line instead of throwing', () => {
		const good = JSON.stringify({
			type: 'message',
			message: { role: 'user', content: 'hello' }
		});
		expect(() => piAdapter.parse(`null\n42\n"str"\n${good}\n`)).not.toThrow();
		expect(piAdapter.parse(`null\n${good}\n`)).toHaveLength(1);
	});
});
