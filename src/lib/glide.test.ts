import { describe, expect, it } from 'vitest';
import { easeIn, glideDuration, glidePosition, MAX_MS, MIN_MS } from './glide';

describe('easeIn', () => {
	it('starts still and ends complete', () => {
		expect(easeIn(0)).toBe(0);
		expect(easeIn(1)).toBe(1);
	});

	/** The point of the curve: the first half covers almost none of it. */
	it('is barely moving at the halfway mark', () => {
		expect(easeIn(0.5)).toBeCloseTo(0.125, 3);
		expect(easeIn(0.5)).toBeLessThan(0.2);
	});

	it('never runs past its ends', () => {
		expect(easeIn(-1)).toBe(0);
		expect(easeIn(5)).toBe(1);
	});
});

describe('glideDuration', () => {
	/** A fixed duration is a crawl over 300px and a blur over 20,000. */
	it('grows with the distance', () => {
		expect(glideDuration(600)).toBeGreaterThan(glideDuration(300));
	});

	it('is quick for a short hop', () => {
		expect(glideDuration(50)).toBe(MIN_MS);
	});

	it('never outstays its welcome', () => {
		expect(glideDuration(20_000)).toBe(MAX_MS);
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
