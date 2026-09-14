import { describe, expect, it } from 'vitest';
import { shortModel } from './short-model';

describe('shortModel', () => {
	it('drops the vendor the mark beside it already says', () => {
		expect(shortModel('claude-opus-5', 'claude')).toBe('opus-5');
		expect(shortModel('claude-haiku-4-5', 'claude')).toBe('haiku-4-5');
	});

	/** What is left has to stay a name you can tell from another one. */
	it('keeps the part that identifies the model', () => {
		expect(shortModel('claude-opus-5', 'claude')).not.toBe('opus');
	});

	it('leaves a name that is only the vendor alone', () => {
		expect(shortModel('claude', 'claude')).toBe('claude');
	});

	/** A separator is required, or a different name starting the same way loses its head. */
	it('does not cut a name that merely begins with the same letters', () => {
		expect(shortModel('claudette-1', 'claude')).toBe('claudette-1');
	});

	it('cuts on a space, slash or underscore too', () => {
		expect(shortModel('codex pro', 'codex')).toBe('pro');
		expect(shortModel('openai/gpt-5', 'openai')).toBe('gpt-5');
		expect(shortModel('omp_fast', 'omp')).toBe('fast');
	});

	it('does not care about case', () => {
		expect(shortModel('Claude-Opus-5', 'claude')).toBe('Opus-5');
		expect(shortModel('CODEX PRO', 'codex')).toBe('PRO');
	});

	it('leaves a model from another vendor entirely alone', () => {
		expect(shortModel('gpt-5', 'claude')).toBe('gpt-5');
	});

	it('copes with nothing to work on', () => {
		expect(shortModel('', 'claude')).toBe('');
		expect(shortModel('claude-opus-5', '')).toBe('claude-opus-5');
	});
});
