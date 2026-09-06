import { describe, expect, it } from 'vitest';
import { previewFrom } from './enrich';
import type { Message } from './transcript/types';

const say = (text: string): Message => ({ role: 'assistant', text, tools: [] });
const tool = (name: string, summary: string): Message => ({
	role: 'assistant',
	text: '',
	tools: [{ name, summary }]
});

describe('previewFrom', () => {
	it('shows the last thing the agent said', () => {
		expect(previewFrom([say('first'), say('second')], 'idle')).toBe('second');
	});

	/** While working, what it is doing is more useful than what it last said. */
	it('prefers the running tool over prose while working', () => {
		expect(previewFrom([say('on it'), tool('Edit', 'src/app.ts')], 'working')).toBe(
			'▸ Edit src/app.ts'
		);
	});

	it('marks a finished turn', () => {
		expect(previewFrom([say('all tests pass')], 'done')).toBe('✓ all tests pass');
	});

	it('says what an empty idle pane is waiting for', () => {
		expect(previewFrom([], 'idle')).toBe('waiting for a prompt');
	});

	it('collapses newlines so a row cannot wrap', () => {
		expect(previewFrom([say('line one\nline two')], 'idle')).toBe('line one line two');
	});

	it('clips a long line rather than letting it push the row', () => {
		const preview = previewFrom([say('x'.repeat(200))], 'idle');
		expect(preview).toHaveLength(80);
		expect(preview.endsWith('…')).toBe(true);
	});

	it('returns nothing rather than inventing text when there is none', () => {
		expect(previewFrom([{ role: 'user', text: 'hi', tools: [] }], 'working')).toBe('');
	});
});
