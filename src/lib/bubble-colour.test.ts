import { describe, expect, it } from 'vitest';
import {
	bubbleInk,
	fillFar,
	mixHex,
	FILL_FADE,
	FILL_VISIBLE,
	DEFAULT_FILL,
	DEFAULT_USER,
	PAGE
} from './bubble-colour';
import { contrastRatio } from './contrast';

/** Every colour a harness bubble can be filled with, both themes. */
const HARNESS = [
	['#ea580c', '#fb923c'],
	['#0d9488', '#2dd4bf'],
	['#7c3aed', '#a78bfa'],
	['#0284c7', '#38bdf8'],
	['#e11d48', '#fb7185'],
	['#059669', '#34d399'],
	['#65a30d', '#a3e635']
];

const AA = 4.5;

describe('bubbleInk', () => {
	it('stays readable at BOTH ends of a faded fill, for every harness', () => {
		// The bug this exists to stop: the ink was picked against the fill's
		// base colour while the fade ran somewhere much darker, so the top of
		// a bubble came out black-on-brown at 2.1:1 while the bottom was fine.
		for (const [light, dark] of HARNESS) {
			for (const [fill, isDark] of [
				[light, false],
				[dark, true]
			] as const) {
				const ink = bubbleInk(fill, isDark, true);
				const near = contrastRatio(ink, fill);
				const far = contrastRatio(ink, fillFar(fill));
				expect(Math.min(near, far), `${fill} dark=${isDark} ink=${ink}`).toBeGreaterThanOrEqual(AA);
			}
		}
	});

	it('is readable on a flat fill too', () => {
		for (const [light, dark] of HARNESS) {
			expect(contrastRatio(bubbleInk(light, false, false), light)).toBeGreaterThanOrEqual(AA);
			expect(contrastRatio(bubbleInk(dark, true, false), dark)).toBeGreaterThanOrEqual(AA);
		}
	});

	it('picks on the worst end, not the average', () => {
		// An average hides the one spot that is actually unreadable.
		const fill = '#fb923c';
		const ink = bubbleInk(fill, true, true);
		expect(contrastRatio(ink, fillFar(fill))).toBeGreaterThanOrEqual(AA);
	});

	it('falls back to theme ink for something it cannot measure', () => {
		expect(bubbleInk('var(--page)', true, true)).toBe('#e5e5e5');
		expect(bubbleInk('var(--page)', false, true)).toBe('#111418');
	});
});

describe('FILL_FADE', () => {
	it('is high enough that the fade never breaks the text', () => {
		// Fading towards the page put claude at 2.10:1 and omp at 4.08:1. The
		// fade now runs the other way, so this holds at any FILL_FADE — and
		// this test is what says so if the direction is ever changed back.
		for (const [light, dark] of HARNESS) {
			for (const [fill, isDark] of [
				[light, false],
				[dark, true]
			] as const) {
				const ink = bubbleInk(fill, isDark, true);
				expect(contrastRatio(ink, fillFar(fill)), fill).toBeGreaterThanOrEqual(AA);
			}
		}
	});

	it('still leaves a fade you can see', () => {
		// Readable is not the only requirement — at 1.0 there would be no
		// gradient at all, which is not the option the user asked for.
		expect(FILL_FADE).toBeLessThan(0.9);
		expect(fillFar('#fb923c')).not.toBe('#fb923c');
	});
});

describe('mixHex', () => {
	it('blends towards the second colour', () => {
		expect(mixHex('#ffffff', '#000000', 1)).toBe('#ffffff');
		expect(mixHex('#ffffff', '#000000', 0)).toBe('#000000');
		expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
	});

	it('returns the first colour when either side is unmeasurable', () => {
		expect(mixHex('var(--page)', '#000000', 0.5)).toBe('var(--page)');
		expect(mixHex('#ffffff', 'var(--page)', 0.5)).toBe('#ffffff');
	});

	it('fades AWAY from the text, never towards it', () => {
		// The whole point: the far end must be further from the ink than the
		// base, so the fade can only ever improve legibility.
		for (const fill of ['#fb923c', '#7c3aed', '#a3e635', '#2f4fd0']) {
			const ink = bubbleInk(fill, true, true);
			expect(contrastRatio(ink, fillFar(fill)), fill).toBeGreaterThanOrEqual(
				contrastRatio(ink, fill)
			);
		}
	});
});

describe('default fills', () => {
	it('are visible against the page they sit on', () => {
		// The light agent fill was #eceef1 against a #f4f5f7 page — 1.07, which
		// is no contrast at all, so a light-mode bubble was an invisible box
		// with text in it. Everything readable was readable by accident.
		expect(contrastRatio(DEFAULT_FILL.light, PAGE.light)).toBeGreaterThanOrEqual(FILL_VISIBLE);
		expect(contrastRatio(DEFAULT_FILL.dark, PAGE.dark)).toBeGreaterThanOrEqual(FILL_VISIBLE);
		expect(contrastRatio(DEFAULT_USER.light, PAGE.light)).toBeGreaterThanOrEqual(FILL_VISIBLE);
		expect(contrastRatio(DEFAULT_USER.dark, PAGE.dark)).toBeGreaterThanOrEqual(FILL_VISIBLE);
	});

	it('carry readable text', () => {
		for (const theme of ['light', 'dark'] as const) {
			for (const fill of [DEFAULT_FILL[theme], DEFAULT_USER[theme]]) {
				const ink = bubbleInk(fill, theme === 'dark', true);
				expect(contrastRatio(ink, fill), fill).toBeGreaterThanOrEqual(4.5);
				expect(contrastRatio(ink, fillFar(fill)), fill).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it('tell the two sides apart', () => {
		// Opposite alignment is the primary signal, but the colours should not
		// be the same brightness either.
		for (const theme of ['light', 'dark'] as const) {
			expect(contrastRatio(DEFAULT_USER[theme], DEFAULT_FILL[theme]), theme).toBeGreaterThan(1.3);
		}
	});
});
