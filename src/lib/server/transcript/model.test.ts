import { mkdtemp, writeFile, appendFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { latestModel, parseModel } from './model';

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

it('recovers middle switches and invalidates for append, truncation and replacement', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'bordr-model-'));
	const file = join(dir, 'session.jsonl');
	try {
		const padding = '{"type":"custom"}\n'.repeat(100_000);
		await writeFile(
			file,
			omp('opening') +
				'\n' +
				padding +
				JSON.stringify({ type: 'model_change', modelId: 'middle' }) +
				'\n' +
				padding
		);
		expect(await latestModel(file)).toBe('middle');
		expect(await latestModel(file)).toBe('middle');
		await appendFile(file, omp('new') + '\n');
		expect(await latestModel(file)).toBe('new');
		await writeFile(file, '');
		expect(await latestModel(file)).toBe('');
		await writeFile(file + '.new', omp('replacement') + '\n');
		await rename(file + '.new', file);
		expect(await latestModel(file)).toBe('replacement');
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it('ignores sidechain model records owned by a child conversation', () => {
	expect(
		parseModel(
			[
				{ type: 'assistant', message: { model: 'parent-opus' } },
				{ type: 'assistant', isSidechain: true, message: { model: 'child-haiku' } }
			]
				.map((row) => JSON.stringify(row))
				.join('\n')
		)
	).toBe('parent-opus');
});
