import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The answer route against three real dialects, with herdr doubled: the
 * screens are what `agent.read --source visible` returned live on
 * 2026-09-07, trimmed to the dialog.
 */
const herdr = vi.hoisted(() => ({
	screens: [] as string[],
	sent: [] as string[][],
	readVisible: vi.fn(async () => herdr.screens.shift() ?? ''),
	getClient: () => ({
		request: vi.fn(async (_method: string, params: { keys: string[] }) => {
			herdr.sent.push(params.keys);
			return {};
		})
	})
}));
vi.mock('$lib/server/herdr', () => herdr);

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

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	herdr.screens.length = 0;
	herdr.sent.length = 0;
});

describe('answer route: dialects', () => {
	it('Claude style: the digit selects and confirms, one keystroke', async () => {
		herdr.screens.push(DIALOG, PROMPT);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['2']]);
		expect(result).toMatchObject({ chose: 'Green', outcome: 'accepted' });
	});

	/** pi ignores digits: the same dialog is still up, highlight unmoved. */
	it('pi style: navigates with arrows and Enter when the digit was inert', async () => {
		herdr.screens.push(DIALOG, DIALOG, PROMPT);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['2'], ['down', 'enter']]);
		expect(result).toMatchObject({ chose: 'Green', outcome: 'accepted' });
	});

	/** A radio dialog: the digit moved the highlight but did not submit. */
	it('radio style: sends Enter when the digit only moved the highlight', async () => {
		herdr.screens.push(DIALOG, DIALOG_ON_2, PROMPT);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['2'], ['enter']]);
		expect(result.outcome).toBe('accepted');
	});

	it('never sends more keys once a different dialog has replaced the first', async () => {
		const other = DIALOG.replace('Which colour?', 'Which size?').replace('Green', 'Large');
		herdr.screens.push(DIALOG, other);
		const result = await answer(2);
		expect(herdr.sent).toEqual([['2']]);
		expect(result.outcome).toBe('unknown');
	});
});
