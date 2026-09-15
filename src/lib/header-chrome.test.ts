import { describe, expect, it } from 'vitest';
import { showBackArrow, showChrome } from './header-chrome';

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

describe('showBackArrow', () => {
	/** The agents list is where the arrow goes; drawn there it goes nowhere. */
	it('is not drawn on the page it points at', () => {
		expect(showBackArrow('always', TOUCH, '/', '/')).toBe(false);
		expect(showBackArrow('mobile', TOUCH, '/', '/')).toBe(false);
		expect(showBackArrow('always', MOUSE, '/settings', '/settings')).toBe(false);
	});

	it('follows the preference everywhere else', () => {
		expect(showBackArrow('always', MOUSE, '/a/w4:p3', '/')).toBe(true);
		expect(showBackArrow('mobile', TOUCH, '/search', '/')).toBe(true);
		expect(showBackArrow('mobile', MOUSE, '/search', '/')).toBe(false);
		expect(showBackArrow('off', TOUCH, '/settings/connection', '/settings')).toBe(false);
	});
});
