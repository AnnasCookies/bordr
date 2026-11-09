import { describe, expect, it } from 'vitest';
import {
	claudeRunEnded,
	isDone,
	resolvedToolUses,
	resolvedToolUseTimes,
	workflowTerminations
} from './subagent-done';

const NOW = 1_700_000_000_000;

const result = (id: string) =>
	JSON.stringify({
		type: 'user',
		message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'done' }] }
	});

describe('workflow terminal evidence', () => {
	it.each(['completed', 'failed', 'killed', 'stopped'])(
		'reads an exact timed harness notice for %s',
		(status) => {
			const content = `<task-notification><task-id>wf_abc-123</task-id><status>${status}</status></task-notification>`;
			const record = { type: 'queue-operation', timestamp: '2026-10-06T10:00:00Z', content };
			expect(workflowTerminations(JSON.stringify(record)).get('wf_abc-123')?.status).toBe(status);
			expect(workflowTerminations(JSON.stringify({ ...record, type: 'assistant' })).size).toBe(0);
			expect(workflowTerminations(JSON.stringify({ ...record, timestamp: undefined })).size).toBe(
				0
			);
			expect(workflowTerminations(JSON.stringify(record)).has('wf_abc')).toBe(false);
		}
	);
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

describe('claudeRunEnded handback', () => {
	const handback = JSON.stringify({
		type: 'assistant',
		message: {
			role: 'assistant',
			stop_reason: 'tool_use',
			content: [{ type: 'tool_use', id: 'toolu_h', name: 'SubagentHandback', input: {} }]
		}
	});
	const reply = (id: string, is_error = false) =>
		JSON.stringify({
			type: 'user',
			message: {
				role: 'user',
				content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error }]
			}
		});

	it('counts a delivered report as the end of the run', () => {
		expect(claudeRunEnded(`${handback}\n${reply('toolu_h')}`)).toBe(true);
	});

	it('does not count the reply to some other tool', () => {
		expect(claudeRunEnded(`${handback}\n${reply('toolu_other')}`)).toBe(false);
	});

	it('finds the hand-back reply behind the rows of a parallel call', () => {
		const parallel = JSON.stringify({
			type: 'assistant',
			message: {
				role: 'assistant',
				stop_reason: 'tool_use',
				content: [
					{ type: 'tool_use', id: 'toolu_a', name: 'Read', input: {} },
					{ type: 'tool_use', id: 'toolu_h', name: 'SubagentHandback', input: {} }
				]
			}
		});
		expect(claudeRunEnded([parallel, reply('toolu_a'), reply('toolu_h')].join('\n'))).toBe(true);
		expect(claudeRunEnded([parallel, reply('toolu_h'), reply('toolu_a')].join('\n'))).toBe(true);
	});

	it('does not count a hand-back that failed', () => {
		expect(claudeRunEnded(`${handback}\n${reply('toolu_h', true)}`)).toBe(false);
	});
});

describe('delivered task notice', () => {
	const at = '2026-10-23T12:00:26.157Z';
	const notice = (status: string) => ({
		type: 'user',
		isMeta: true,
		origin: { kind: 'task-notification' },
		timestamp: at,
		message: {
			content: `[SYSTEM NOTIFICATION]\n<task-notification><tool-use-id>toolu_x</tool-use-id><status>${status}</status></task-notification>`
		}
	});

	it.each(['completed', 'failed', 'killed', 'stopped'])(
		'reads a harness-marked %s notice sent into a sub-agent, with its time',
		(status) => {
			expect(resolvedToolUseTimes(JSON.stringify(notice(status))).get('toolu_x')).toBe(
				Date.parse(at)
			);
		}
	);

	it('ignores a notice without the harness mark or a finished status', () => {
		const plain = { ...notice('completed'), origin: undefined };
		expect(resolvedToolUseTimes(JSON.stringify(plain)).has('toolu_x')).toBe(false);
		expect(resolvedToolUseTimes(JSON.stringify(notice('running'))).has('toolu_x')).toBe(false);
	});

	it('finishes a depth-2 child from its parent sub-agent transcript', () => {
		// The parent sub-agent's file holds the launch row and the later notice.
		const launch = JSON.stringify({
			type: 'user',
			timestamp: '2026-10-23T11:59:00.000Z',
			message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_x' }] },
			toolUseResult: { status: 'async_launched' }
		});
		const parent = [launch, JSON.stringify(notice('completed'))].join('\n');
		const resolved = resolvedToolUseTimes(parent);
		const lastWrite = Date.parse('2026-10-23T12:00:20.000Z');
		expect(isDone({ toolUseId: 'toolu_x', lastAt: lastWrite }, resolved)).toBe(true);
		// The child writing again after the notice is a resumed run, not finished.
		expect(isDone({ toolUseId: 'toolu_x', lastAt: Date.parse(at) + 1000 }, resolved)).toBe(false);
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
