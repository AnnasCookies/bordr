import { describe, expect, it } from 'vitest';
import { echoesAnswer, holdsAnswer } from './answer-echo';

const SINGLE = { multi: false };
const MULTI = { multi: true };

describe('answering a picker', () => {
	it('echoes and holds a confirmed single-select answer', () => {
		expect(echoesAnswer(SINGLE)).toBe(true);
		expect(holdsAnswer(SINGLE, 'accepted')).toBe(true);
	});

	/** Unconfirmed is when the reader must see the card: echo, but never hide it. */
	it('keeps the card for an unconfirmed single-select answer', () => {
		expect(echoesAnswer(SINGLE)).toBe(true);
		expect(holdsAnswer(SINGLE, 'unknown')).toBe(false);
		expect(holdsAnswer(SINGLE, undefined)).toBe(false);
	});

	/**
	 * The bug this exists for: the answer route says `accepted` when a box
	 * flips, and that hid the card and its Submit button after the first tick
	 * and showed the ticked option as a sent message.
	 */
	it('never hides or echoes a multi-select picker after a tick', () => {
		expect(echoesAnswer(MULTI)).toBe(false);
		expect(holdsAnswer(MULTI, 'accepted')).toBe(false);
		expect(holdsAnswer(MULTI, 'unknown')).toBe(false);
	});

	/** A picker gone by the time of the tap behaves as it always did. */
	it('treats a missing picker as single-select', () => {
		expect(echoesAnswer(null)).toBe(true);
		expect(holdsAnswer(undefined, 'accepted')).toBe(true);
	});
});
