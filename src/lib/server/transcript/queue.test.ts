import { describe, expect, it } from 'vitest';
import { queueVerdict } from '$lib/queue';
import { parseQueue } from './queue';

const op = (operation: string, content: string, extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		type: 'queue-operation',
		operation,
		content,
		timestamp: '2026-09-13T16:20:53.509Z',
		...extra
	});

describe('parseQueue', () => {
	it('reports a prompt still waiting behind the turn', () => {
		expect(parseQueue(op('enqueue', 'have a look at this'))).toEqual([
			{ text: 'have a look at this', at: Date.parse('2026-09-13T16:20:53.509Z'), taken: false }
		]);
	});

	/**
	 * The case that read wrongly. On a long turn the agent takes a queued
	 * message without waiting for the turn to end, and the harness records that
	 * as a `remove` — so the bubble went on saying "queued behind this turn"
	 * after the agent had already answered it.
	 */
	it('counts an absorbed message as taken', () => {
		const text = [
			op('enqueue', 'already acknowledged'),
			op('remove', 'already acknowledged', { reason: 'absorbed_mid_turn' })
		].join('\n');
		expect(queueVerdict('already acknowledged', parseQueue(text))).toBe('taken');
	});

	it('counts a dequeue at the start of a turn as taken', () => {
		const text = [op('enqueue', 'next job'), op('dequeue', 'next job')].join('\n');
		expect(queueVerdict('next job', parseQueue(text))).toBe('taken');
	});

	/**
	 * A `remove` is not always the agent. Deleting a queued message before it
	 * is sent is one too, and marking that read would say the agent has
	 * something nobody ever sent it.
	 */
	it('forgets a message the person removed unsent', () => {
		const text = [
			op('enqueue', 'changed my mind'),
			op('remove', 'changed my mind', { reason: 'user_removed' })
		].join('\n');
		expect(parseQueue(text)).toEqual([]);
		expect(queueVerdict('changed my mind', parseQueue(text))).toBeNull();
	});

	it('takes the last word on a prompt, not the first', () => {
		const text = [
			op('enqueue', 'one'),
			op('remove', 'one', { reason: 'absorbed_mid_turn' }),
			op('enqueue', 'two')
		].join('\n');
		expect(queueVerdict('one', parseQueue(text))).toBe('taken');
		expect(queueVerdict('two', parseQueue(text))).toBe('queued');
	});

	/** The phone sends with a trailing newline the harness does not record. */
	it('matches across the whitespace the two ends disagree about', () => {
		const queue = parseQueue(op('enqueue', 'mind  the\ngap'));
		expect(queueVerdict('mind the gap\n', queue)).toBe('queued');
	});

	it('ignores everything that is not a queue operation', () => {
		const text = [
			JSON.stringify({ type: 'user', message: { content: 'hello' } }),
			'not json at all',
			JSON.stringify(null),
			op('enqueue', '   ')
		].join('\n');
		expect(parseQueue(text)).toEqual([]);
	});

	/**
	 * Null, never 'queued'. A harness that reports no queue at all must not
	 * make every message look stuck — the caller falls back instead.
	 */
	it('has no opinion about a prompt it never saw', () => {
		expect(queueVerdict('never sent', parseQueue(op('enqueue', 'something else')))).toBeNull();
		expect(queueVerdict('anything', [])).toBeNull();
	});
});
