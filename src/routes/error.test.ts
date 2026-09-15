import { describe, expect, it } from 'vitest';
import { FIRST_WAIT_MS, MAX_WAIT_MS } from '$lib/recover';
import {
	afterProbe,
	attemptsKey,
	FORGET_AFTER_MS,
	MAX_ATTEMPT,
	readAttempt,
	shouldReload,
	wakeDue,
	writeAttempt
} from './+error.svelte';

describe('error page recovery', () => {
	/**
	 * The loop this exists to stop: herdr down, the pane's load answering 503,
	 * and the page reloading into it every couple of seconds. Only a page that
	 * now loads — or answers with something that is not a recoverable
	 * failure — may be reloaded into.
	 */
	it('reloads only when re-requesting the page no longer fails recoverably', () => {
		expect(shouldReload(200)).toBe(true);
		expect(shouldReload(404)).toBe(true);
		expect(shouldReload(503)).toBe(false);
		expect(shouldReload(500)).toBe(false);
		expect(shouldReload(429)).toBe(false);
		expect(shouldReload(0)).toBe(false);
	});

	it('waits longer after every failed probe, up to the cap', () => {
		let attempt = 0;
		const waits: number[] = [];
		for (let round = 0; round < 12; round++) {
			const verdict = afterProbe(503, attempt);
			expect(verdict.reload).toBe(false);
			waits.push(verdict.wait);
			attempt = verdict.attempt;
		}
		expect(waits[0]).toBe(FIRST_WAIT_MS * 2);
		for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThanOrEqual(waits[i - 1]);
		expect(Math.max(...waits)).toBe(MAX_WAIT_MS);
		expect(attempt).toBeLessThanOrEqual(MAX_ATTEMPT);
	});

	/**
	 * A reload resets component state, which is why the backoff never grew.
	 * The count has to come back out of storage as it went in, and a reload
	 * that lands on the same failure must still count as an attempt.
	 */
	it('carries the count across a reload, including the reload itself', () => {
		const verdict = afterProbe(200, 3);
		expect(verdict.reload).toBe(true);
		expect(verdict.attempt).toBe(4);
		const stored = writeAttempt(verdict.attempt, 10_000);
		expect(readAttempt(stored, 12_000)).toBe(4);
	});

	it('keys the count by path, so one failing page does not slow another', () => {
		expect(attemptsKey('/a/w1:p1')).not.toBe(attemptsKey('/a/w1:p2'));
	});

	it('forgets a stale count, so a new failure starts short again', () => {
		const stored = writeAttempt(8, 10_000);
		expect(readAttempt(stored, 10_000 + FORGET_AFTER_MS + 1)).toBe(0);
	});

	it('treats nonsense in storage as no attempts', () => {
		for (const raw of [null, '', 'nope', '42', '{"attempt":-1,"at":1}', '{"attempt":2.5,"at":1}']) {
			expect(readAttempt(raw, 2), String(raw)).toBe(0);
		}
		expect(readAttempt(JSON.stringify({ attempt: 9_999, at: 1 }), 2)).toBe(MAX_ATTEMPT);
		// A clock that went backwards is not evidence of anything recent.
		expect(readAttempt(writeAttempt(3, 5_000), 1_000)).toBe(0);
	});

	it('does not let waking the page get round the backoff', () => {
		expect(wakeDue(10_000, 10_000 + FIRST_WAIT_MS - 1)).toBe(false);
		expect(wakeDue(10_000, 10_000 + FIRST_WAIT_MS)).toBe(true);
	});
});
