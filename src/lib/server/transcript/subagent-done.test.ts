import { describe, expect, it } from 'vitest';
import { isDone, resolvedToolUses } from './subagent-done';

const NOW = 1_700_000_000_000;

const result = (id: string) =>
	JSON.stringify({
		type: 'user',
		message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] }
	});

describe('resolvedToolUses', () => {
	it('finds the tool calls that have been answered', () => {
		const text = [result('toolu_a'), result('toolu_b')].join('\n');
		expect([...resolvedToolUses(text)].sort()).toEqual(['toolu_a', 'toolu_b']);
	});

	it('ignores a call that has not come back yet', () => {
		const pending = JSON.stringify({
			type: 'assistant',
			message: { content: [{ type: 'tool_use', id: 'toolu_c', name: 'Task' }] }
		});
		expect(resolvedToolUses(pending).has('toolu_c')).toBe(false);
	});

	it('survives the rubbish a live transcript contains', () => {
		const text = ['', 'not json', JSON.stringify(null), '{"message":{"content":"a string"}}'].join(
			'\n'
		);
		expect(resolvedToolUses(text).size).toBe(0);
	});
});

describe('isDone', () => {
	const resolved = new Set(['toolu_finished']);

	/** The exact signal: the harness wrote the Task's result. */
	it('is done the moment its result is written', () => {
		expect(isDone({ toolUseId: 'toolu_finished', lastAt: NOW }, resolved)).toBe(true);
	});

	it('is running while its result is outstanding', () => {
		expect(isDone({ toolUseId: 'toolu_going', lastAt: NOW - 1000 }, resolved)).toBe(false);
	});

	/**
	 * The fallback, for a result written outside the window of the parent
	 * transcript that was read — a depth-2 agent, or an old one.
	 */
	it('never calls an unresolved quiet child done', () => {
		const lastAt = NOW - 120_000 - 1;
		expect(isDone({ toolUseId: 'toolu_going', lastAt }, resolved)).toBe(false);
	});

	it('holds on through a pause shorter than the window', () => {
		const lastAt = NOW - 120_000 + 1000;
		expect(isDone({ toolUseId: 'toolu_going', lastAt }, resolved)).toBe(false);
	});

	/**
	 * A sidecar can exist before its agent has written a word. Ageing that out
	 * would mark a just-dispatched agent finished before it started.
	 */
	it('never gives up on one that has not written yet', () => {
		expect(isDone({ toolUseId: 'toolu_new', lastAt: 0 }, resolved)).toBe(false);
	});
});
