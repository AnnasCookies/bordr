import { describe, expect, it } from 'vitest';
import { GRACE_MS, keepPending, landedIn, onScreen, say, type PendingSend } from './pending-sends';

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
		expect(keepPending([pending()], ['run the tests'], false, NOW)).toEqual([]);
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
