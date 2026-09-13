import { describe, expect, it } from 'vitest';
import { easeIn, glideDuration, glidePosition, MAX_MS, MIN_MS } from './glide';

describe('easeIn', () => {
	it('starts still and ends complete', () => {
		expect(easeIn(0)).toBe(0);
		expect(easeIn(1)).toBe(1);
	});

	/** The point of the curve: the first half covers almost none of it. */
	it('is barely moving at the halfway mark', () => {
		expect(easeIn(0.5)).toBeCloseTo(0.17, 2);
		expect(easeIn(0.5)).toBeLessThan(0.2);
	});

	/**
	 * But it must be moving. Pure cubic covered 0.7% in the first tenth, which
	 * on a real transcript was a pixel a frame and read as a dead pause.
	 */
	it('has visibly set off by the first tenth', () => {
		expect(easeIn(0.1)).toBeGreaterThan(0.01);
	});

	it('never runs past its ends', () => {
		expect(easeIn(-1)).toBe(0);
		expect(easeIn(5)).toBe(1);
	});
});

describe('glideDuration', () => {
	/** A fixed duration is a crawl over 300px and a blur over 20,000. */
	it('grows with the distance', () => {
		expect(glideDuration(4_000)).toBeGreaterThan(glideDuration(1_000));
		expect(glideDuration(30_000)).toBeGreaterThan(glideDuration(4_000));
	});

	/** But sub-linearly, or a long transcript becomes a wait. */
	it('grows slower than the distance does', () => {
		expect(glideDuration(40_000)).toBeLessThan(glideDuration(10_000) * 4);
	});

	it('is quick for a short hop', () => {
		expect(glideDuration(50)).toBe(MIN_MS);
	});

	it('never outstays its welcome', () => {
		expect(glideDuration(500_000)).toBe(MAX_MS);
	});

	/**
	 * The bug this file exists for, as a number.
	 *
	 * A phone transcript is tens of thousands of pixels, and the old
	 * proportional-then-capped duration gave every one of them the same 520ms.
	 * At 16,000px that is a final frame of 1,504px — two screens in one frame,
	 * which is a cut, not a movement. Whatever the distance, no single frame
	 * may cross more than one screen.
	 */
	it('never crosses more than a screen in one frame', () => {
		const frame = 1000 / 60;
		// distance, and the most its final frame may cross. A whole phone
		// screen for the ordinary trip; a transcript half a mile long ends
		// fast, but a fling ends fast too — what it may not do is cut.
		const limits: [number, number][] = [
			[2_000, 400],
			[16_000, 844],
			[52_000, 1_300]
		];
		for (const [distance, ceiling] of limits) {
			const duration = glideDuration(distance);
			const last = distance - glidePosition(0, distance, duration - frame, duration);
			expect(last).toBeLessThan(ceiling);
		}
	});

	it('does not care which way it is going', () => {
		expect(glideDuration(-900)).toBe(glideDuration(900));
	});
});

describe('glidePosition', () => {
	it('begins where it began and ends where it was aimed', () => {
		expect(glidePosition(100, 900, 0, 400)).toBe(100);
		expect(glidePosition(100, 900, 400, 400)).toBe(900);
	});

	/**
	 * Read fresh each frame, so a transcript that grows mid-glide is followed
	 * rather than landing short of a bottom that has moved.
	 */
	it('re-aims when the target moves', () => {
		const half = glidePosition(0, 1000, 200, 400);
		const moved = glidePosition(0, 2000, 200, 400);
		expect(moved).toBeGreaterThan(half);
	});

	it('lands immediately when there is no time to take', () => {
		expect(glidePosition(0, 500, 0, 0)).toBe(500);
	});
});
