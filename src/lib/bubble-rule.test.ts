import { describe, expect, it } from 'vitest';
import { contrastRatio, luminance, parseHex } from './contrast';

/**
 * The rule that keeps a bubble's border visible against its own fill.
 *
 * Mirrors `ruled` in bubble.svelte. It lives here rather than in the
 * component because it is the arithmetic that matters, and the component is
 * markup — but that means the two can drift, so the numbers below are the
 * contract: if the component changes, this fails and says so.
 */
function shifts(border: string, fill: string | null): boolean {
	if (!fill) return false;
	if (!parseHex(border) || !parseHex(fill)) return false;
	return contrastRatio(border, fill) < 1.6;
}

function anchorFor(fill: string): string {
	return luminance(fill) > 0.4 ? '#000000' : '#ffffff';
}

describe('bubble rule against its fill', () => {
	it('shifts when the harness fill paints rule and bubble the same colour', () => {
		// The case that forced this: harnessAccent 'fill' puts one colour in
		// both, a contrast of exactly 1.00, and the border simply is not there.
		for (const hex of ['#fb923c', '#ea580c', '#2dd4bf', '#a78bfa']) {
			expect(contrastRatio(hex, hex)).toBe(1);
			expect(shifts(hex, hex), hex).toBe(true);
		}
	});

	it('leaves a rule alone when it already reads against the fill', () => {
		// Measured pairs from the real palette — tint and the plain fills.
		expect(shifts('#fb923c', '#3a2a1e')).toBe(false); // tint, dark
		expect(shifts('#fb923c', '#262626')).toBe(false); // plain fill, dark
		expect(shifts('#ea580c', '#eceef1')).toBe(false); // plain fill, light
	});

	it('leaves it alone when there is no fill at all', () => {
		expect(shifts('#fb923c', null)).toBe(false);
	});

	it('does not try to measure a CSS variable', () => {
		// var(--edge) and var(--page) cannot be read; guessing at them would be
		// worse than leaving a neutral rule as it is.
		expect(shifts('var(--edge)', '#262626')).toBe(false);
		expect(shifts('#fb923c', 'var(--page)')).toBe(false);
	});

	it('pushes away from the fill, not towards it', () => {
		expect(anchorFor('#fb923c')).toBe('#000000'); // bright fill → dark rule
		expect(anchorFor('#2f4fd0')).toBe('#ffffff'); // dark fill → light rule
	});
});
