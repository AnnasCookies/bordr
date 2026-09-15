import { describe, expect, it } from 'vitest';
import { queueVerdict } from './queue';

const SENT = Date.parse('2026-09-14T10:00:00Z');

describe('queueVerdict with a send time', () => {
	/**
	 * The bug this exists for: the queue is keyed by text, so a second
	 * "continue" found the first one's record, already taken, and showed read
	 * ticks before the harness had queued it.
	 */
	it('says nothing from an earlier send of the same words', () => {
		const queue = [{ text: 'continue', at: SENT - 60_000, taken: true }];
		expect(queueVerdict('continue', queue, SENT)).toBeNull();
	});

	it('reads the record this send made', () => {
		expect(
			queueVerdict('continue', [{ text: 'continue', at: SENT + 300, taken: false }], SENT)
		).toBe('queued');
		expect(
			queueVerdict('continue', [{ text: 'continue', at: SENT + 900, taken: true }], SENT)
		).toBe('taken');
	});

	/** A phone clock a little ahead of the host must not lose the verdict. */
	it('leaves clock-skew and close-repeat collisions unconfirmed', () => {
		const at = (ms: number) => [{ text: 'continue', at: SENT - ms, taken: true }];
		expect(queueVerdict('continue', at(1000), SENT)).toBeNull();
		expect(queueVerdict('continue', at(5001), SENT)).toBeNull();
	});

	it('counts any record when no send time is given', () => {
		expect(queueVerdict('continue', [{ text: 'continue', at: 0, taken: true }])).toBe('taken');
	});
});
