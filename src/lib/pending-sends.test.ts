import { describe, expect, it } from 'vitest';
import {
	GRACE_MS,
	restorePending,
	keepPending,
	landedIn,
	onScreen,
	say,
	seenIn,
	transcriptPrompts,
	type PendingSend
} from './pending-sends';

const NOW = 1_000_000;
const pending = (over: Partial<PendingSend> = {}): PendingSend => ({
	id: 1,
	text: 'run the tests',
	at: NOW - GRACE_MS - 5_000, // well past the grace period
	state: 'queued',
	...over
});

describe('keepPending', () => {
	/**
	 * The bug this file exists for. On a slow link a send can take longer than
	 * the grace period; the bubble vanished while the POST was still in the
	 * air, so the message looked stuck and then disappeared. A request in
	 * flight has not been offered to the agent and refused — it has not been
	 * offered at all.
	 */
	it('keeps a prompt whose request has not come back yet', () => {
		const still = keepPending([pending({ state: 'sending' })], [], true, NOW);
		expect(still).toHaveLength(1);
	});

	it('retires one the transcript shows the agent took', () => {
		expect(keepPending([pending()], [{ text: 'run the tests', at: NOW }], false, NOW)).toEqual([]);
	});

	it('retires a single new matching prompt when the harness supplies no timestamp', () => {
		expect(
			keepPending(
				[pending({ seen: 0, window: 1 })],
				[{ text: 'run the tests', at: 0 }],
				false,
				NOW,
				1
			)
		).toEqual([]);
	});

	it('does not manufacture acknowledgement for an older saved send without a snapshot', () => {
		const legacy = pending();
		expect(keepPending([legacy], [{ text: 'run the tests', at: 0 }], false, NOW, 1)).toEqual([
			legacy
		]);
	});

	it('does not acknowledge two prefix-overlapping sends from one untimed prompt', () => {
		const sends = [
			pending({ seen: 0, window: 1 }),
			pending({ id: 2, text: 'run the tests twice', seen: 0, window: 1 })
		];
		expect(keepPending(sends, [{ text: 'run the tests twice', at: 0 }], false, NOW, 1)).toEqual(
			sends
		);
	});

	it('retires a delivered one the agent never took, once it has settled', () => {
		expect(keepPending([pending()], [], true, NOW)).toEqual([]);
	});

	it('keeps a delivered one while the agent is still working', () => {
		expect(keepPending([pending()], [], false, NOW)).toHaveLength(1);
	});

	it('keeps a delivered one inside the grace period', () => {
		const fresh = pending({ at: NOW - 1_000 });
		expect(keepPending([fresh], [], true, NOW)).toHaveLength(1);
	});

	it('does not acknowledge a repeated untimed send from the earlier identical turn', () => {
		const repeated = pending({ seen: 1, window: 1 });
		const earlier = { text: 'run the tests', at: 0 };
		expect(keepPending([repeated], [earlier], false, NOW, 1)).toEqual([repeated]);
		expect(keepPending([repeated], [earlier, earlier], false, NOW, 1)).toEqual([]);
	});

	it('does not use old matches added by widening the transcript window', () => {
		const fresh = pending({ seen: 0, window: 1 });
		expect(keepPending([fresh], [{ text: 'run the tests', at: 0 }], false, NOW, 4)).toEqual([
			fresh
		]);
	});

	it('does not discard ambiguous duplicate sends or multiple new untimed matches', () => {
		const sent = pending({ seen: 0, window: 1 });
		const landed = { text: 'run the tests', at: 0 };
		expect(keepPending([sent, { ...sent, id: 2 }], [landed], false, NOW, 1)).toHaveLength(2);
		expect(keepPending([sent], [landed, landed], false, NOW, 1)).toEqual([sent]);
	});

	it('keeps an in-flight or interrupted send even when an untimed match exists', () => {
		for (const state of ['sending', 'unconfirmed'] as const) {
			const sent = pending({ state, seen: 0, window: 1 });
			expect(keepPending([sent], [{ text: 'run the tests', at: 0 }], false, NOW, 1)).toEqual([
				sent
			]);
		}
	});
});

it('snapshots the same normalised user prompts and shell commands that cleanup matches', () => {
	const landed = transcriptPrompts([
		{ role: 'assistant', text: 'run the tests', tools: [] },
		{ role: 'user', text: 'run\n the   tests', tools: [] },
		{
			role: 'user',
			text: '',
			at: NOW,
			tools: [],
			blocks: [
				{
					kind: 'tool',
					name: '!',
					summary: '',
					input: { command: 'echo   fixture' },
					result: null,
					diffs: []
				}
			]
		}
	]);
	expect(landed).toEqual([
		{ text: 'run the tests', at: 0 },
		{ text: '!echo fixture', at: NOW }
	]);
	expect(seenIn('run the tests', landed)).toBe(1);
	expect(seenIn('!echo fixture', landed)).toBe(0);
});

describe('landedIn', () => {
	it('matches when a harness has appended to what it was given', () => {
		expect(landedIn('run the tests', ['run the tests\n\n<context>…</context>'])).toBe(true);
	});

	/** A newline where the transcript had a space is not a different prompt. */
	it('ignores how the whitespace came back', () => {
		expect(landedIn('run\nthe   tests', ['run the tests'])).toBe(true);
	});

	it('does not match a different prompt that merely starts the same way', () => {
		expect(landedIn('run the tests twice', ['run the tests'])).toBe(false);
	});

	it('never matches on empty text', () => {
		expect(landedIn('   ', ['anything'])).toBe(false);
	});
});

describe('say', () => {
	it('flattens whitespace and trims', () => {
		expect(say('  a\n\n b  ')).toBe('a b');
	});
});

describe('the grace period runs from delivery', () => {
	/**
	 * A slow send that took most of the grace period would otherwise eat it,
	 * and the bubble would vanish the moment it was finally delivered — which
	 * is the worst possible time, because that is when it is real.
	 */
	it('gives a slowly-delivered prompt its full grace after delivery', () => {
		const slow = pending({ at: NOW - 26_000, deliveredAt: NOW - 1_000 });
		expect(keepPending([slow], [], true, NOW)).toHaveLength(1);
	});

	it('still retires it once that grace has run out', () => {
		const slow = pending({ at: NOW - 60_000, deliveredAt: NOW - GRACE_MS - 1_000 });
		expect(keepPending([slow], [], true, NOW)).toEqual([]);
	});
});

describe('onScreen', () => {
	/**
	 * The point of the whole thing: a harness parks a prompt it has taken but
	 * not started under its composer, so the screen answers "has the agent got
	 * this?" minutes before the transcript does.
	 */
	it('finds a prompt the harness is holding on screen', () => {
		const screen =
			'> some earlier output\n\n❯ \n  run the tests and report back\n  ⏵⏵ auto mode on';
		expect(onScreen('run the tests and report back', screen)).toBe(true);
	});

	/** The terminal wraps; whitespace is not meaning. */
	it('matches across a line the terminal wrapped', () => {
		const screen = '❯\n  run the tests and then\n  report back to me\n';
		expect(onScreen('run the tests and then report back to me', screen)).toBe(true);
	});

	it('matches on the head, so a wrap further in cannot break it', () => {
		const long = 'please look at the failing migration and tell me which column it is';
		const screen = `❯\n  ${long.slice(0, 64)}\n  ${long.slice(64)}`;
		expect(onScreen(long, screen)).toBe(true);
	});

	/**
	 * A false two ticks is worse than a slow one — it would claim the agent has
	 * something it has never seen — so short prompts are not matched at all.
	 */
	it('refuses to match something too short to be distinctive', () => {
		expect(onScreen('yes', 'the screen happens to say yes somewhere')).toBe(false);
		expect(onScreen('ok', 'ok')).toBe(false);
	});

	it('is false when the prompt is nowhere on the screen', () => {
		expect(onScreen('run the tests and report back', '❯\n  something else entirely')).toBe(false);
	});
});

it('keeps reload-interrupted sends recoverable without reaping or resending', () => {
	const restored = restorePending(pending({ state: 'sending' }));
	expect(restored.state).toBe('unconfirmed');
	expect(
		keepPending([restored], [{ text: 'run the tests', at: NOW }], true, NOW + 999_999)
	).toEqual([restored]);
});

it('does not retire a repeated send from an earlier identical transcript turn', () => {
	expect(
		keepPending([pending({ at: NOW })], [{ text: 'run the tests', at: NOW - 1000 }], false, NOW)
	).toHaveLength(1);
});
