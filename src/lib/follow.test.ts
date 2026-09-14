import { describe, expect, it } from 'vitest';
import { nextFollowing } from './follow';

const moment = (over: Partial<Parameters<typeof nextFollowing>[1]> = {}) => ({
	top: 1000,
	lastTop: 1000,
	atBottom: false,
	programmatic: false,
	...over
});

describe('nextFollowing', () => {
	it('stops following when the reader scrolls up', () => {
		expect(nextFollowing(true, moment({ top: 800, lastTop: 1000 }))).toBe(false);
	});

	it('follows again once the end is reached', () => {
		expect(nextFollowing(false, moment({ top: 1200, lastTop: 1000, atBottom: true }))).toBe(true);
	});

	/**
	 * The regression this file exists for. A new turn makes the scroller
	 * taller, so the end moves away while the reader has not moved at all —
	 * `top` is unchanged and `atBottom` is now false. Recomputing from
	 * geometry turned following off here, which put the jump button on screen
	 * while you were sitting at the end.
	 */
	it('leaves a follower alone when the transcript grows underneath them', () => {
		expect(nextFollowing(true, moment({ top: 1000, lastTop: 1000, atBottom: false }))).toBe(true);
	});

	it('leaves someone who scrolled up alone when it grows', () => {
		expect(nextFollowing(false, moment({ top: 1000, lastTop: 1000, atBottom: false }))).toBe(false);
	});

	/**
	 * Our own scroll-to-bottom fires a scroll event like any other. Read as
	 * the reader moving, the jump back after a poll would look like a scroll
	 * up whenever the content had shrunk.
	 */
	it('does not read our own scroll as the reader moving', () => {
		expect(nextFollowing(true, moment({ top: 400, lastTop: 1000, programmatic: true }))).toBe(true);
	});

	it('still follows when our own scroll lands at the end', () => {
		expect(
			nextFollowing(false, moment({ top: 2000, lastTop: 1000, atBottom: true, programmatic: true }))
		).toBe(true);
	});

	/** Sub-pixel drift and trackpad jitter are not a decision. */
	it('ignores a movement of a pixel or two', () => {
		expect(nextFollowing(true, moment({ top: 998, lastTop: 1000 }))).toBe(true);
	});

	it('scrolling down without reaching the end does not resume following', () => {
		expect(nextFollowing(false, moment({ top: 1400, lastTop: 1000, atBottom: false }))).toBe(false);
	});
});
