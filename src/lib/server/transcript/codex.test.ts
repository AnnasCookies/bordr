import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexAdapter } from './codex';
import { adapterFor } from './index';

/** Shapes taken from a real ~/.codex/sessions rollout file. */
const SESSION = [
	'{"type":"session_meta","payload":{"id":"abc"}}',
	'{"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"harness scaffolding"}]}}',
	'{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"check the repo"}]}}',
	'{"type":"response_item","payload":{"type":"reasoning","encrypted_content":"opaque","summary":[]}}',
	'{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"On it."}]}}',
	'{"type":"response_item","payload":{"type":"local_shell_call","action":{"command":["git","status"]}}}',
	'{"type":"response_item","payload":{"type":"function_call","name":"read_file","arguments":"{\\"path\\":\\"/repo/README.md\\"}"}}',
	'{"type":"event_msg","payload":{"type":"token_count"}}'
].join('\n');

describe('codexAdapter.parse', () => {
	it('keeps user and assistant turns only', () => {
		expect(codexAdapter.parse(SESSION).map((m) => m.role)).toEqual(['user', 'assistant']);
	});

	it('never renders developer scaffolding', () => {
		expect(JSON.stringify(codexAdapter.parse(SESSION))).not.toContain('harness scaffolding');
	});

	it('never renders injected AGENTS.md context as a user message', () => {
		const injected =
			'{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions\\n<INSTRUCTIONS>do things</INSTRUCTIONS>"}]}}\n';
		const parsed = codexAdapter.parse(injected + SESSION);
		expect(parsed.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(JSON.stringify(parsed)).not.toContain('AGENTS.md');
	});

	it('never renders encrypted reasoning', () => {
		expect(JSON.stringify(codexAdapter.parse(SESSION))).not.toContain('opaque');
	});

	it('attaches tool calls to the preceding assistant turn', () => {
		const assistant = codexAdapter.parse(SESSION)[1];
		expect(assistant.text).toBe('On it.');
		expect(assistant.tools).toEqual([
			{ name: 'shell', summary: 'git status' },
			{ name: 'read_file', summary: '/repo/README.md' }
		]);
	});

	it('skips malformed lines rather than throwing', () => {
		expect(codexAdapter.parse('not json\n' + SESSION)).toHaveLength(2);
	});

	it('skips a bare null line rather than throwing on `.type`', () => {
		expect(codexAdapter.parse('null\n' + SESSION)).toHaveLength(2);
	});

	it('never renders a single-tag wrapper codex injects as the user', () => {
		const plugins =
			'<recommended_plugins>\n- name: foo\n  reason: does things\n- name: bar\n</recommended_plugins>';
		const line = JSON.stringify({
			type: 'response_item',
			payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: plugins }] }
		});
		const parsed = codexAdapter.parse(line + '\n' + SESSION);
		expect(parsed.map((m) => m.role)).toEqual(['user', 'assistant']);
		expect(JSON.stringify(parsed)).not.toContain('recommended_plugins');
	});

	it('still renders a typed question that merely mentions a tag', () => {
		const question = 'Why does <recommended_plugins> keep appearing in my session?';
		const line = JSON.stringify({
			type: 'response_item',
			payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: question }] }
		});
		expect(codexAdapter.parse(line)).toEqual([{ role: 'user', text: question, tools: [] }]);
	});

	it('does not treat two adjacent wrappers as one injected block', () => {
		const two = '<a>first</a> and <a>second</a>';
		const line = JSON.stringify({
			type: 'response_item',
			payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: two }] }
		});
		expect(codexAdapter.parse(line)).toHaveLength(1);
	});
});

describe('codexAdapter.resolve', () => {
	it('accepts only absolute existing paths', async () => {
		expect(await codexAdapter.resolve('rollout-abc')).toBeNull();
		expect(await codexAdapter.resolve('/no/such/rollout.jsonl')).toBeNull();
	});
});

describe('adapter registry', () => {
	it('routes codex to the codex adapter', () => {
		expect(adapterFor('codex')?.parse('')).toEqual(codexAdapter.parse(''));
	});
});

describe('codex adapter: resolve', () => {
	// A throwaway CODEX_HOME with two days of rollouts; the pane's id is in
	// the older day, so the search has to look past today.
	const HOME = mkdtempSync(join(tmpdir(), 'bordr-test-codex-'));
	const ID = '0b7a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
	const OLD = join(HOME, 'sessions', '2026', '09', '03');
	const NEW = join(HOME, 'sessions', '2026', '09', '04');
	mkdirSync(OLD, { recursive: true });
	mkdirSync(NEW, { recursive: true });
	writeFileSync(join(OLD, `rollout-2026-09-03T10-00-00-${ID}.jsonl`), '');
	writeFileSync(
		join(NEW, 'rollout-2026-09-04T09-00-00-ffffffff-ffff-4fff-8fff-ffffffffffff.jsonl'),
		''
	);
	const previous = process.env.CODEX_HOME;
	process.env.CODEX_HOME = HOME;
	afterAll(() => {
		if (previous === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = previous;
		rmSync(HOME, { recursive: true, force: true });
	});

	it('finds the rollout for a session id, as the current herdr integration reports', async () => {
		const path = await codexAdapter.resolve(ID);
		expect(path).toBe(join(OLD, `rollout-2026-09-03T10-00-00-${ID}.jsonl`));
	});

	it('still accepts an absolute path, as older integrations reported', async () => {
		const path = join(
			NEW,
			'rollout-2026-09-04T09-00-00-ffffffff-ffff-4fff-8fff-ffffffffffff.jsonl'
		);
		expect(await codexAdapter.resolve(path)).toBe(path);
		expect(await codexAdapter.resolve(join(NEW, 'missing.jsonl'))).toBeNull();
	});

	it('returns null for an unknown id and for a value that is neither', async () => {
		expect(await codexAdapter.resolve('11111111-2222-4333-8444-555555555555')).toBeNull();
		expect(await codexAdapter.resolve('not-a-session')).toBeNull();
	});
});

/** codex asks through a tool and polls for typed input: measured 2026-09-07. */
describe('codex adapter: request_user_input', () => {
	const call = (args: unknown) =>
		JSON.stringify({
			type: 'response_item',
			payload: {
				type: 'function_call',
				name: 'request_user_input_async',
				arguments: JSON.stringify(args),
				call_id: 'c1'
			}
		});
	const user = (text: string) =>
		JSON.stringify({
			type: 'response_item',
			payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
		});

	it('keeps the question and options on the message', () => {
		const [m] = codexAdapter.parse(
			call({ questions: [{ title: 'Which colour?', options: ['Red', 'Green', 'Blue'] }] })
		);
		expect(m.ask).toEqual({ question: 'Which colour?', options: ['Red', 'Green', 'Blue'] });
		expect(m.tools[0]).toEqual({ name: 'request_user_input_async', summary: 'Which colour?' });
	});

	it('is a pending picker until the person types, then not', async () => {
		const { pendingAsk } = await import('../picker');
		const asked = codexAdapter.parse(
			call({ questions: [{ title: 'Which colour?', options: ['Red', 'Green'] }] })
		);
		expect(pendingAsk(asked)?.answer).toBe('text');
		expect(pendingAsk(asked)?.options.map((o) => o.label)).toEqual(['Red', 'Green']);
		const answered = codexAdapter.parse(
			call({ questions: [{ title: 'Which colour?', options: ['Red', 'Green'] }] }) +
				'\n' +
				user('Green')
		);
		expect(pendingAsk(answered)).toBeNull();
	});
});
