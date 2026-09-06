import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { grokAdapter } from './grok';
import { copilotAdapter } from './copilot';
import { adapterFor } from './index';

const ID = '4d4b1a5e-0c8a-4f0e-9c1d-2a3b4c5d6e7f';

/** Record shapes as measured in real files on 2026-09-07. */
describe('grok adapter', () => {
	const lines = [
		{ type: 'system', content: 'You are Grok 4.6 released by xAI.' },
		{
			type: 'user',
			content: [{ type: 'text', text: '<user_info>\nOS Version: linux\n</user_info>' }]
		},
		{
			type: 'user',
			synthetic_reason: 'skills',
			content: [{ type: 'text', text: '<system-reminder>\nThe following skills are available' }]
		},
		{
			type: 'user',
			prompt_index: 0,
			content: [{ type: 'text', text: '<user_query>\nHi Grok just testing\n</user_query>' }]
		},
		{ type: 'reasoning', content: null, summary: [], encrypted_content: 'x', status: 'done' },
		{
			type: 'assistant',
			content: "I'll open the image you sent and check it.",
			tool_calls: [
				{ id: 'c1', name: 'read_file', arguments: '{"target_file":"/home/dev/shot.jpeg"}' }
			],
			model_id: 'grok-4.6'
		},
		{ type: 'tool_result', tool_call_id: 'c1', content: 'Read image file: /home/dev/shot.jpeg' },
		{
			type: 'assistant',
			content: 'Hi — I’m here. What do you want to work on?',
			model_id: 'grok-4.6'
		}
	]
		.map((e) => JSON.stringify(e))
		.join('\n');

	it('renders typed prompts and the model, and drops scaffolding, reasoning and tool output', () => {
		expect(grokAdapter.parse(`null\n${lines}`)).toEqual([
			{ role: 'user', text: 'Hi Grok just testing', tools: [] },
			{
				role: 'assistant',
				text: "I'll open the image you sent and check it.",
				tools: [{ name: 'read_file', summary: '/home/dev/shot.jpeg' }]
			},
			{ role: 'assistant', text: 'Hi — I’m here. What do you want to work on?', tools: [] }
		]);
	});

	const HOME = mkdtempSync(join(tmpdir(), 'bordr-test-grok-'));
	const DIR = join(HOME, 'sessions', '%2Fhome%2Fdev%2Fproject', ID);
	mkdirSync(DIR, { recursive: true });
	writeFileSync(join(DIR, 'chat_history.jsonl'), '');
	const previous = process.env.GROK_HOME;
	process.env.GROK_HOME = HOME;
	afterAll(() => {
		if (previous === undefined) delete process.env.GROK_HOME;
		else process.env.GROK_HOME = previous;
		rmSync(HOME, { recursive: true, force: true });
	});

	it('finds the session id under whichever project directory holds it', async () => {
		expect(await grokAdapter.resolve(ID)).toBe(join(DIR, 'chat_history.jsonl'));
		expect(await grokAdapter.resolve('11111111-2222-4333-8444-555555555555')).toBeNull();
		expect(adapterFor('grok')?.parse('')).toEqual(grokAdapter.parse(''));
	});
});

describe('copilot adapter', () => {
	const lines = [
		{ type: 'session.start', data: { sessionId: ID, copilotVersion: '0.0.1' } },
		{ type: 'system.message', data: { role: 'system', content: 'You are Copilot.' } },
		{ type: 'user.message', data: { content: 'run echo hi', attachments: [] } },
		{ type: 'assistant.turn_start', data: { turnId: '0' } },
		{
			type: 'tool.execution_start',
			data: { toolCallId: 'c1', toolName: 'report_intent', arguments: { intent: 'Running echo' } }
		},
		{
			type: 'tool.execution_start',
			data: { toolCallId: 'c2', toolName: 'bash', arguments: { command: 'echo hi' } }
		},
		{ type: 'tool.execution_complete', data: { toolCallId: 'c2', success: true, result: {} } },
		{ type: 'assistant.message', data: { content: 'Done: hi', toolRequests: [] } },
		{ type: 'assistant.turn_end', data: { turnId: '0' } },
		{ type: 'session.shutdown', data: { shutdownType: 'user' } }
	]
		.map((e) => JSON.stringify(e))
		.join('\n');

	it('renders the person, each tool call and the reply, nothing else', () => {
		expect(copilotAdapter.parse(lines)).toEqual([
			{ role: 'user', text: 'run echo hi', tools: [] },
			{ role: 'assistant', text: '', tools: [{ name: 'report_intent', summary: 'Running echo' }] },
			{ role: 'assistant', text: '', tools: [{ name: 'bash', summary: 'echo hi' }] },
			{ role: 'assistant', text: 'Done: hi', tools: [] }
		]);
	});

	const HOME = mkdtempSync(join(tmpdir(), 'bordr-test-copilot-'));
	const DIR = join(HOME, 'session-state', ID);
	mkdirSync(DIR, { recursive: true });
	writeFileSync(join(DIR, 'events.jsonl'), '');
	const previous = process.env.COPILOT_HOME;
	process.env.COPILOT_HOME = HOME;
	afterAll(() => {
		if (previous === undefined) delete process.env.COPILOT_HOME;
		else process.env.COPILOT_HOME = previous;
		rmSync(HOME, { recursive: true, force: true });
	});

	it('maps the session id to its event log', async () => {
		expect(await copilotAdapter.resolve(ID)).toBe(join(DIR, 'events.jsonl'));
		expect(await copilotAdapter.resolve('nope')).toBeNull();
		expect(adapterFor('copilot')?.parse('')).toEqual(copilotAdapter.parse(''));
	});
});
