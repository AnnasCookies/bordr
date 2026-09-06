import { describe, expect, it } from 'vitest';
import { contrastRatio, luminance, meetsAA, parseHex, readableTextOn } from './contrast';

describe('parseHex', () => {
	it('accepts both hex lengths, with or without the hash', () => {
		expect(parseHex('#ffffff')).toEqual([255, 255, 255]);
		expect(parseHex('000')).toEqual([0, 0, 0]);
		expect(parseHex('#3558E6')).toEqual([53, 88, 230]);
	});

	it('rejects anything that is not a hex colour', () => {
		for (const bad of ['', 'red', '#12', '#12345', 'rgb(0,0,0)', '#gggggg']) {
			expect(parseHex(bad), bad).toBeNull();
		}
	});
});

describe('luminance', () => {
	it('anchors at the ends of the scale', () => {
		expect(luminance('#000000')).toBe(0);
		expect(luminance('#ffffff')).toBeCloseTo(1, 5);
	});
});

describe('contrastRatio', () => {
	/** The two fixed points of the WCAG scale. */
	it('is 21 for black on white and 1 for a colour on itself', () => {
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#3558e6', '#3558e6')).toBeCloseTo(1, 5);
	});

	it('does not care which way round the pair is given', () => {
		expect(contrastRatio('#3558e6', '#ffffff')).toBeCloseTo(
			contrastRatio('#ffffff', '#3558e6'),
			10
		);
	});
});

describe('readableTextOn', () => {
	it('picks white on dark and black on light', () => {
		expect(readableTextOn('#111418')).toBe('#ffffff');
		expect(readableTextOn('#3558e6')).toBe('#ffffff');
		expect(readableTextOn('#fff7e6')).toBe('#000000');
		expect(readableTextOn('#e5e7eb')).toBe('#000000');
	});

	/** Whatever it picks must actually be readable, not merely the better of two. */
	it('always returns a choice that passes AA on that background', () => {
		for (const bg of ['#3558e6', '#16a34a', '#d97706', '#171717', '#f4f5f7', '#808080']) {
			expect(meetsAA(bg, readableTextOn(bg)), bg).toBe(true);
		}
	});
});

describe('meetsAA', () => {
	it('flags a pair that is too close to read', () => {
		expect(meetsAA('#3558e6', '#4060ee')).toBe(false);
		expect(meetsAA('#ffffff', '#767676')).toBe(true);
		expect(meetsAA('#ffffff', '#888888')).toBe(false);
	});
});
