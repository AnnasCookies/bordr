import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agyAdapter } from './agy';
import { adapterFor } from './index';

const line = (o: Record<string, unknown>) =>
	JSON.stringify({ created_at: '2026-09-07T10:00:00+01:00', status: 'DONE', step_index: 0, ...o });

/** Record shapes as measured in a real agy transcript on 2026-09-07. */
const TRANSCRIPT = [
	line({
		type: 'SYSTEM_MESSAGE',
		source: 'SYSTEM',
		content: 'The following is a <SYSTEM_MESSAGE> not actually sent by the user.'
	}),
	line({
		type: 'USER_INPUT',
		source: 'USER_EXPLICIT',
		content:
			'<USER_REQUEST>\nWhat kind of pumpkin\n</USER_REQUEST>\n<ADDITIONAL_CONTEXT>cwd</ADDITIONAL_CONTEXT>'
	}),
	line({
		type: 'PLANNER_RESPONSE',
		source: 'MODEL',
		thinking: 'private reasoning',
		tool_calls: [
			{
				name: 'view_file',
				args: { AbsolutePath: '/home/dev/shot.jpeg', toolSummary: 'view shot.jpeg' }
			}
		]
	}),
	line({
		type: 'GENERIC',
		source: 'MODEL',
		content: 'Created At: … Completed At: … (tool output)'
	}),
	line({
		type: 'PLANNER_RESPONSE',
		source: 'MODEL',
		thinking: 'more private reasoning',
		content: '### 1. Species: Cucurbita pepo'
	}),
	line({ type: 'PLANNER_RESPONSE', source: 'MODEL', thinking: 'only thinking, no output' }),
	line({ type: 'CHECKPOINT', source: 'SYSTEM', content: '{{ CHECKPOINT 0 }} The earlier parts…' })
].join('\n');

describe('agy adapter: parse', () => {
	it('renders the person, the model and its tool calls, and nothing of the scaffolding', () => {
		expect(agyAdapter.parse(TRANSCRIPT)).toEqual([
			{ role: 'user', text: 'What kind of pumpkin', tools: [] },
			{ role: 'assistant', text: '', tools: [{ name: 'view_file', summary: 'view shot.jpeg' }] },
			{ role: 'assistant', text: '### 1. Species: Cucurbita pepo', tools: [] },
			{ role: 'system', text: '→ context compacted', tools: [] }
		]);
	});

	it('never shows thinking, and skips a null line', () => {
		const out = agyAdapter.parse(`null\n${TRANSCRIPT}`);
		expect(JSON.stringify(out)).not.toContain('private reasoning');
	});

	it('falls back to the command line when a tool wrote no summary', () => {
		const out = agyAdapter.parse(
			line({
				type: 'PLANNER_RESPONSE',
				source: 'MODEL',
				tool_calls: [{ name: 'run_command', args: { CommandLine: 'bun test', Cwd: '/x' } }]
			})
		);
		expect(out[0].tools).toEqual([{ name: 'run_command', summary: 'bun test' }]);
	});
});

describe('agy adapter: resolve', () => {
	const HOME = mkdtempSync(join(tmpdir(), 'bordr-test-agy-'));
	const ID = '13e6d1fe-176e-4384-89a7-3e88dda15d67';
	const LOGS = join(HOME, 'antigravity-cli', 'brain', ID, '.system_generated', 'logs');
	mkdirSync(LOGS, { recursive: true });
	writeFileSync(join(LOGS, 'transcript.jsonl'), '');
	const previous = process.env.GEMINI_HOME;
	process.env.GEMINI_HOME = HOME;
	afterAll(() => {
		if (previous === undefined) delete process.env.GEMINI_HOME;
		else process.env.GEMINI_HOME = previous;
		rmSync(HOME, { recursive: true, force: true });
	});

	it('maps the id herdr reports onto the brain transcript', async () => {
		expect(await agyAdapter.resolve(ID)).toBe(join(LOGS, 'transcript.jsonl'));
		expect(await agyAdapter.resolve('11111111-2222-4333-8444-555555555555')).toBeNull();
		expect(await agyAdapter.resolve('nope')).toBeNull();
	});

	it('is registered for the agy harness', () => {
		expect(adapterFor('agy')?.parse('')).toEqual(agyAdapter.parse(''));
	});
});
