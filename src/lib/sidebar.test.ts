import { describe, expect, it } from 'vitest';
import { clampSidebar, DEFAULT_SIDEBAR, MAX_SIDEBAR, MIN_SIDEBAR } from './sidebar';

describe('clampSidebar', () => {
	it('keeps a width that is already sensible', () => {
		expect(clampSidebar(320)).toBe(320);
		expect(clampSidebar(MIN_SIDEBAR)).toBe(MIN_SIDEBAR);
		expect(clampSidebar(MAX_SIDEBAR)).toBe(MAX_SIDEBAR);
	});

	it('pulls a drag past either end back to it', () => {
		// Dragging the handle to the left edge of the window, or off the right.
		expect(clampSidebar(-40)).toBe(MIN_SIDEBAR);
		expect(clampSidebar(4000)).toBe(MAX_SIDEBAR);
	});

	/**
	 * Storage is the untrusted input here: prefs clamps what it reads, so a
	 * hand-edited or corrupted value cannot leave the sidebar at 3px wide with
	 * no way to grab it back.
	 */
	it('falls back to the default for a value that is not a number', () => {
		expect(clampSidebar(Number.NaN)).toBe(DEFAULT_SIDEBAR);
		expect(clampSidebar(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SIDEBAR);
	});

	it('rounds, so a width is always a whole pixel', () => {
		expect(clampSidebar(301.6)).toBe(302);
	});
});
