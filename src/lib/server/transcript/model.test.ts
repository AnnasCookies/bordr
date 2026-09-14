import { describe, expect, it } from 'vitest';
import { parseModel } from './model';

const claude = (model: string) =>
	JSON.stringify({ type: 'assistant', message: { role: 'assistant', model, content: [] } });
const omp = (model: string) => JSON.stringify({ type: 'model_change', model });

describe('parseModel', () => {
	/** Both shapes were taken off live transcripts. */
	it('reads the model off a Claude Code assistant turn', () => {
		expect(parseModel(claude('claude-opus-5'))).toBe('claude-opus-5');
	});

	it("reads omp's own model_change entry", () => {
		expect(parseModel(omp('openai-codex/gpt-5.6-sol'))).toBe('gpt-5.6-sol');
	});

	/**
	 * `/model` mid-session is a thing people do, and the question a header
	 * answers is always "what is it on NOW".
	 */
	it('takes the last word, not the first', () => {
		expect(parseModel([omp('a/one'), omp('b/two')].join('\n'))).toBe('two');
		expect(parseModel([claude('opus'), claude('sonnet')].join('\n'))).toBe('sonnet');
	});

	/** A vendor prefix is routing, not identity. */
	it('drops the vendor prefix', () => {
		expect(parseModel(omp('openai-codex/gpt-5.6-sol'))).toBe('gpt-5.6-sol');
		expect(parseModel(omp('gpt-5.6-sol'))).toBe('gpt-5.6-sol');
	});

	it('ignores everything that names no model', () => {
		const text = [
			JSON.stringify({ type: 'user', message: { content: 'talk about "model" all you like' } }),
			'not json',
			JSON.stringify(null),
			JSON.stringify({ type: 'assistant', message: { model: '' } })
		].join('\n');
		expect(parseModel(text)).toBe('');
	});

	/**
	 * Claude Code stamps turns it invents itself — an interruption, an API
	 * error — with `<synthetic>`. No model answered those, so the header keeps
	 * the last model that did.
	 */
	it("skips Claude Code's <synthetic> placeholder", () => {
		expect(parseModel([claude('claude-opus-5'), claude('<synthetic>')].join('\n'))).toBe(
			'claude-opus-5'
		);
		expect(parseModel(claude('<synthetic>'))).toBe('');
	});

	it('has nothing to say about an empty transcript', () => {
		expect(parseModel('')).toBe('');
	});
});
