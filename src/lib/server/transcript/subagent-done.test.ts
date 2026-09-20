import { describe, expect, it } from 'vitest';
import { claudeRunEnded, isDone, resolvedToolUses, resolvedToolUseTimes } from './subagent-done';

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

	it('ignores the immediate result that only says an async agent launched', () => {
		const text = JSON.stringify({
			type: 'user',
			timestamp: '2026-09-19T17:19:52.626Z',
			message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_async' }] },
			toolUseResult: { status: 'async_launched' }
		});
		expect(resolvedToolUses(text).has('toolu_async')).toBe(false);
	});

	it.each(['completed', 'failed', 'killed', 'stopped'])(
		'finds an async task-notification with terminal status %s',
		(status) => {
			const text = JSON.stringify({
				type: 'queue-operation',
				timestamp: '2026-09-19T17:26:29.484Z',
				content: `<task-notification><tool-use-id>toolu_async</tool-use-id><status>${status}</status></task-notification>`
			});
			expect(resolvedToolUseTimes(text).get('toolu_async')).toBe(
				Date.parse('2026-09-19T17:26:29.484Z')
			);
		}
	);

	it('survives the rubbish a live transcript contains', () => {
		const text = ['', 'not json', JSON.stringify(null), '{"message":{"content":"a string"}}'].join(
			'\n'
		);
		expect(resolvedToolUses(text).size).toBe(0);
	});
});

describe('claudeRunEnded', () => {
	it('uses the latest conversational row, so a resumed child is live again', () => {
		const stopped = JSON.stringify({
			type: 'assistant',
			message: { role: 'assistant', stop_reason: 'end_turn' }
		});
		expect(claudeRunEnded(stopped)).toBe(true);
		expect(
			claudeRunEnded(
				`${stopped}\n${JSON.stringify({ type: 'user', message: { role: 'user', content: 'Again' } })}`
			)
		).toBe(false);
	});

	it('keeps a child in a tool turn running', () => {
		expect(
			claudeRunEnded(
				JSON.stringify({
					type: 'assistant',
					message: { role: 'assistant', stop_reason: 'tool_use' }
				})
			)
		).toBe(false);
	});
});

describe('isDone', () => {
	const resolved = new Map([['toolu_finished', NOW]]);

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

	it('treats a child write after completion as a resumed live run', () => {
		expect(isDone({ toolUseId: 'toolu_finished', lastAt: NOW + 1 }, resolved)).toBe(false);
	});

	/**
	 * A sidecar can exist before its agent has written a word. Ageing that out
	 * would mark a just-dispatched agent finished before it started.
	 */
	it('never gives up on one that has not written yet', () => {
		expect(isDone({ toolUseId: 'toolu_new', lastAt: 0 }, resolved)).toBe(false);
	});
});
