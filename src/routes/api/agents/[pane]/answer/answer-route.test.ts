import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parsePicker } from '#lib/server/picker.js';
import { pickerIdentity } from '#lib/picker-shortcut.js';
import { createHash } from 'node:crypto';

/**
 * The answer route against three real dialects, with herdr doubled: the
 * screens are what `agent.read --source visible` returned live on
 * 2026-09-07, trimmed to the dialog.
 */
const herdr = vi.hoisted(() => ({
	screens: [] as string[],
	sent: [] as string[][],
	readVisible: vi.fn(async () => herdr.screens.shift() ?? ''),
	rawAgent: vi.fn(async () => null as null | { agent: string }),
	// The route sends through sendKeys now, which resolves the pane's machine
	// before it ever reaches a client.
	sendKeys: vi.fn(async (_pane: string, keys: string[]) => {
		herdr.sent.push(keys);
	}),
	sendText: vi.fn(async (_pane: string, text: string) => {
		herdr.sent.push([`text:${text}`]);
	}),
	promptAgent: vi.fn(async (_pane: string, text: string) => {
		herdr.sent.push([`prompt:${text}`]);
	})
}));
vi.mock('#lib/server/herdr/index.js', () => herdr);

/**
 * A codex transcript whose newest record is an unanswered question. Only the
 * codex tests reach these: every other test's pane has no agent record, so
 * the route never looks for a transcript.
 */
const CODEX_ASK = {
	question: 'Where will you test Sera?',
	options: ['Existing staging site', 'Local preview']
};
vi.mock('#lib/server/transcript/index.js', () => ({
	adapterFor: () => ({ parse: () => [{ role: 'assistant', text: '', ask: CODEX_ASK }] })
}));
vi.mock('#lib/server/transcript/resolve.js', () => ({
	resolveLocalTranscript: async () => '/tmp/codex-session.jsonl'
}));
vi.mock('#lib/server/transcript/tail.js', () => ({
	readTranscriptTail: async () => ({ text: '' }),
	DEFAULT_TAIL_BYTES: 1
}));

const DIALOG = [
	' Which colour?',
	'❯ 1. Red',
	'     Choose red.',
	'  2. Green',
	'     Choose green.',
	'  3. Blue',
	'     Choose blue.',
	' Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel'
].join('\n');
const DIALOG_ON_2 = DIALOG.replace('❯ 1. Red', '  1. Red').replace('  2. Green', '❯ 2. Green');
const OMP_NERD_DIALOG = [
	'│ Pick a colour. │',
	'│   Red       │',
	'│    Green     │',
	'│    Blue      │',
	'│ Enter select · n note · ↑/↓ move · Esc cancel'
].join('\n');
const PROMPT = '❯ \n';

async function answer(index: number) {
	const { POST } = await import('./+server');
	const request = new Request('http://bordr.test/api/agents/w1:p1/answer', {
		method: 'POST',
		body: JSON.stringify({ index })
	});
	const response = await POST({ params: { pane: 'w1:p1' }, request } as never);
	return (await response.json()) as { chose: string; outcome: string };
}

async function post(body: Record<string, unknown>) {
	const { POST } = await import('./+server');
	const request = new Request('http://bordr.test/api/agents/w1:p1/answer', {
		method: 'POST',
		body: JSON.stringify(body)
	});
	const response = await POST({ params: { pane: 'w1:p1' }, request } as never);
	return (await response.json()) as { chose: string; outcome: string };
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	herdr.screens.length = 0;
	herdr.sent.length = 0;
	herdr.rawAgent.mockResolvedValue(null);
	herdr.promptAgent.mockImplementation(async (_pane: string, text: string) => {
		herdr.sent.push([`prompt:${text}`]);
	});
});

describe('answer route: dialects', () => {
	it('Claude style: selects and confirms in one key sequence', async () => {
		herdr.screens.push(DIALOG, PROMPT);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['down', 'enter']]);
		expect(result).toMatchObject({ chose: 'Green', outcome: 'accepted' });
	});

	/** pi ignores digits: use its arrows and Enter without a trial keystroke. */
	it('pi style: navigates and confirms once', async () => {
		herdr.screens.push(DIALOG, PROMPT);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['down', 'enter']]);
		expect(result).toMatchObject({ chose: 'Green', outcome: 'accepted' });
	});

	it('a delayed radio redraw stays unknown, without another Enter', async () => {
		herdr.screens.push(DIALOG, DIALOG_ON_2, PROMPT);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['down', 'enter']]);
		expect(result.outcome).toBe('unknown');
		expect(herdr.screens).toHaveLength(1);
	});

	it('does not answer a second plain question with identical wording', async () => {
		herdr.screens.push(DIALOG, DIALOG, PROMPT);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['down', 'enter']]);
		expect(result.outcome).toBe('unknown');
		expect(herdr.screens).toHaveLength(1);
	});

	it('uses a digit once when no highlight can be observed', async () => {
		herdr.screens.push(DIALOG.replace('❯', ' '), PROMPT);
		expect((await answer(2)).outcome).toBe('accepted');
		expect(herdr.sent).toEqual([['2']]);
	});

	it('OMP nerd-symbol ask: navigates with arrows and Enter', async () => {
		herdr.screens.push(OMP_NERD_DIALOG, PROMPT);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['down', 'enter']]);
		expect(result).toMatchObject({ chose: 'Green', outcome: 'accepted' });
	});

	it('refuses an unparsed OMP ask instead of guessing from transcript options', async () => {
		herdr.screens.push('clipped OMP dialog');
		herdr.rawAgent.mockResolvedValue({ agent: 'omp' });
		await expect(answer(2)).rejects.toMatchObject({ status: 409 });
		expect(herdr.sent).toEqual([]);
	});

	it('never sends more keys once a different dialog has replaced the first', async () => {
		const other = DIALOG.replace('Which colour?', 'Which size?').replace('Green', 'Large');
		herdr.screens.push(DIALOG, other);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['down', 'enter']]);
		expect(result.outcome).toBe('unknown');
	});
});

it('refuses malformed answer input before reading or driving a pane', async () => {
	herdr.readVisible.mockClear();
	for (const body of [null, [], { index: -1 }, { index: 1.5 }, { index: 1, submit: 'yes' }])
		await expect(post(body as never)).rejects.toMatchObject({ status: 400 });
	const { POST } = await import('./+server');
	await expect(
		POST({
			params: { pane: 'w1:p1' },
			request: new Request('http://fixture', { method: 'POST', body: 'not JSON' })
		} as never)
	).rejects.toMatchObject({ status: 400 });
	expect(herdr.readVisible).not.toHaveBeenCalled();
	expect(herdr.sent).toEqual([]);
});

it('refuses queued notification answers for a different question before sending keys', async () => {
	const old = DIALOG.replace('Which colour?', 'Old question?');
	herdr.screens.push(DIALOG);
	const dialogHash = createHash('sha256')
		.update(pickerIdentity(parsePicker(old)))
		.digest('hex');
	await expect(post({ index: 1, dialogHash })).rejects.toMatchObject({ status: 409 });
	expect(herdr.sent).toEqual([]);
});

it('accepts a bound notification and refuses malformed fingerprints before reading the pane', async () => {
	herdr.screens.push(DIALOG, PROMPT);
	const dialogHash = createHash('sha256')
		.update(pickerIdentity(parsePicker(DIALOG)))
		.digest('hex');
	expect(await post({ index: 2, dialogHash })).toMatchObject({
		chose: 'Green',
		outcome: 'accepted'
	});
	herdr.readVisible.mockClear();
	await expect(post({ index: 1, dialogHash: 'invalid' })).rejects.toMatchObject({ status: 400 });
	expect(herdr.readVisible).not.toHaveBeenCalled();
});

const preview = (subject: string) =>
	[
		'Apply this change?',
		'❯ 1. Yes'.padEnd(34) + '┌──────────────────────┐',
		'  2. No'.padEnd(34) + `│ ${subject.padEnd(20)} │`,
		' '.repeat(34) + '└──────────────────────┘',
		'Enter to select · ↑/↓ to navigate · Esc to cancel'
	].join('\n');

it('refuses a stale preview even when the replacement question has identical labels', async () => {
	herdr.screens.push(preview('subject B'));
	await expect(
		post({ index: 1, dialog: pickerIdentity(parsePicker(preview('subject A'))) })
	).rejects.toMatchObject({ status: 409 });
	expect(herdr.sent).toEqual([]);
});

it.each(['subject A', 'subject B'])(
	'confirms a preview once without pressing Enter into successor %s',
	async (subject) => {
		herdr.screens.push(preview('subject A'), preview(subject));
		const result = await answer(1);
		expect(herdr.sent).toEqual([['enter']]);
		expect(result.outcome).toBe('unknown');
	}
);

describe('answer route: write-in rows', () => {
	/** pi's ask extension (rpiv-ask-user-question): its last row takes text. */
	const WRITE_IN_DIALOG = [
		' Which colours?',
		'❯ 1. Red',
		'  2. Green',
		'  3. Type something.',
		' Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel'
	].join('\n');

	it('reaches the row with arrows alone, types the answer, then confirms it', async () => {
		herdr.screens.push(WRITE_IN_DIALOG, PROMPT);
		const result = await post({ index: 3, text: 'Purple' });
		expect(herdr.sent).toEqual([['down', 'down'], ['text:Purple'], ['enter']]);
		expect(result).toMatchObject({ chose: 'Purple', outcome: 'accepted' });
	});

	/** The reported defect: a digit, then arrows and Enter, confirmed an empty field. */
	it('never confirms a write-in row without text', async () => {
		// Each request reads the screen afresh.
		herdr.screens.push(WRITE_IN_DIALOG, WRITE_IN_DIALOG);
		await expect(post({ index: 3 })).rejects.toMatchObject({ status: 400 });
		await expect(post({ index: 3, text: '   ' })).rejects.toMatchObject({ status: 400 });
		expect(herdr.sent).toEqual([]);
	});

	it('refuses control characters in the typed answer', async () => {
		herdr.screens.push(WRITE_IN_DIALOG);
		await expect(post({ index: 3, text: 'red[2J' })).rejects.toMatchObject({ status: 400 });
		expect(herdr.sent).toEqual([]);
	});
});

/**
 * codex 0.155's `request_user_input_async`. Shapes from codex's own render
 * snapshots, with the key names it prints on Linux.
 */
const CODEX_COLLAPSED = [
	'• Explored the deploy config.',
	'',
	'  ? 1 question · 45s',
	'    alt + ↑ to answer',
	'',
	'› Ask Codex to do anything'
].join('\n');
const CODEX_OPENED = [
	'  Where will you test Sera?',
	'',
	'  › 1. Existing staging site',
	'    2. Local preview',
	'    3. Other (write an answer)',
	'',
	'  enter submit   ctrl + ] skip',
	'  alt + ↓ main prompt'
].join('\n');
const CODEX_IDLE = '› Ask Codex to do anything';

describe('answer route: codex questions', () => {
	beforeEach(() => {
		herdr.rawAgent.mockResolvedValue({
			agent: 'codex',
			agent_session: { value: 'session-1' }
		} as never);
	});

	it('opens a collapsed question and answers it with its digit, not a typed prompt', async () => {
		// herdr refuses a typed prompt while the question waits (seen 2026-09-19),
		// so the answer must go through the question itself.
		herdr.screens.push(CODEX_COLLAPSED, CODEX_COLLAPSED, CODEX_OPENED, CODEX_IDLE);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['alt+up'], ['down', 'enter']]);
		expect(result).toMatchObject({ chose: 'Local preview', outcome: 'accepted' });
	});

	it('still types the answer when nothing on screen is waiting to be opened', async () => {
		herdr.screens.push(CODEX_IDLE, CODEX_IDLE);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['prompt:Local preview']]);
		expect(result.chose).toBe('Local preview');
	});

	it('reports a question herdr will not take typed input for as a conflict, not a crash', async () => {
		herdr.screens.push(CODEX_IDLE, CODEX_IDLE);
		herdr.promptAgent.mockRejectedValueOnce(
			Object.assign(new Error('agent w1:p1 is blocked and requires interactive input'), {
				code: 'agent_blocked'
			})
		);
		await expect(answer(2)).rejects.toMatchObject({ status: 409 });
	});

	it('sends nothing more when the opened question cannot be read', async () => {
		herdr.screens.push(CODEX_COLLAPSED, CODEX_COLLAPSED, 'unreadable', 'unreadable', 'unreadable');
		await expect(answer(2)).rejects.toMatchObject({ status: 409 });
		expect(herdr.sent).toEqual([['alt+up']]);
	});

	it('finds a long option that wrapped onto a second row by its first line', async () => {
		const wrapped = CODEX_OPENED.replace(
			'    2. Local preview',
			'    2. Local preview on this machine,\n       served from the main worktree'
		);
		CODEX_ASK.options[1] = 'Local preview on this machine, served from the main worktree';
		try {
			herdr.screens.push(CODEX_COLLAPSED, CODEX_COLLAPSED, wrapped, CODEX_IDLE);
			const result = await answer(2);
			expect(herdr.sent).toEqual([['alt+up'], ['down', 'enter']]);
			expect(result.outcome).toBe('accepted');
		} finally {
			CODEX_ASK.options[1] = 'Local preview';
		}
	});

	it('refuses a different opened question even when every offered label is unchanged', async () => {
		const other = CODEX_OPENED.replace('Where will you test Sera?', 'When will you test Sera?');
		herdr.screens.push(CODEX_COLLAPSED, CODEX_COLLAPSED, other);
		await expect(answer(2)).rejects.toMatchObject({ status: 409 });
		expect(herdr.sent).toEqual([['alt+up']]);
	});

	it('refuses when the opened question does not offer the chosen answer', async () => {
		const other = CODEX_OPENED.replace('Local preview', 'Production');
		herdr.screens.push(CODEX_COLLAPSED, CODEX_COLLAPSED, other);
		await expect(answer(2)).rejects.toMatchObject({ status: 409 });
		expect(herdr.sent).toEqual([['alt+up']]);
	});
});
