import { describe, expect, it } from 'vitest';
import { GLIDE_UP_SLACK, glideInterrupted } from './glide-interrupt';

const CALM = { live: true, touching: false, top: 1_000, written: 1_000 };

describe('glideInterrupted', () => {
	it('carries on while nothing has happened', () => {
		expect(glideInterrupted(CALM)).toBe(false);
		expect(glideInterrupted({ ...CALM, written: null })).toBe(false);
	});

	/** Downward is the glide's own direction; the reader helping it along is not a stop. */
	it('carries on when the position moved down', () => {
		expect(glideInterrupted({ ...CALM, top: 1_400 })).toBe(false);
	});

	it('ignores rounding of the position it wrote', () => {
		expect(glideInterrupted({ ...CALM, top: 1_000 - GLIDE_UP_SLACK })).toBe(false);
	});

	/** The reader cannot stop the glide: the bug this exists for. */
	it('stops when the reader scrolls back up', () => {
		expect(glideInterrupted({ ...CALM, top: 1_000 - GLIDE_UP_SLACK - 1 })).toBe(true);
		expect(glideInterrupted({ ...CALM, top: 200 })).toBe(true);
	});

	it('stops the moment a finger is on the glass', () => {
		expect(glideInterrupted({ ...CALM, touching: true })).toBe(true);
		expect(glideInterrupted({ ...CALM, touching: true, written: null })).toBe(true);
	});

	/** Leaving mid-glide must not scroll whatever page comes next. */
	it('stops once the page is no longer on screen', () => {
		expect(glideInterrupted({ ...CALM, live: false })).toBe(true);
	});
});
