import { describe, expect, it } from 'vitest';
import { showChrome } from './header-chrome';

const TOUCH = 5;
const MOUSE = 0;

describe('showChrome', () => {
	it('draws it everywhere when always', () => {
		expect(showChrome('always', TOUCH)).toBe(true);
		expect(showChrome('always', MOUSE)).toBe(true);
	});

	it('draws nothing when off', () => {
		expect(showChrome('off', TOUCH)).toBe(false);
		expect(showChrome('off', MOUSE)).toBe(false);
	});

	/** A tablet counts: it has the gesture and the thumb, which is the point. */
	it('draws it on a touch screen only when mobile', () => {
		expect(showChrome('mobile', TOUCH)).toBe(true);
		expect(showChrome('mobile', 1)).toBe(true);
		expect(showChrome('mobile', MOUSE)).toBe(false);
	});
});
