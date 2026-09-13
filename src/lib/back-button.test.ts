import { describe, expect, it } from 'vitest';
import { backPlacement } from './back-button';

const TOUCH = 5;
const MOUSE = 0;

describe('backPlacement', () => {
	it('is nothing when switched off, whatever the device', () => {
		expect(backPlacement('off', TOUCH)).toBeUndefined();
		expect(backPlacement('off', MOUSE)).toBeUndefined();
	});

	/** The arrow and the mark go to the same place, so only one of them shows. */
	it('replaces the mark when always on', () => {
		expect(backPlacement('on', TOUCH)).toBe('instead');
		expect(backPlacement('on', MOUSE)).toBe('instead');
	});

	it('keeps the mark when asked for both', () => {
		expect(backPlacement('both', TOUCH)).toBe('beside');
		expect(backPlacement('both', MOUSE)).toBe('beside');
	});

	/**
	 * The whole point of 'auto': a phone already has an edge swipe and a system
	 * button, and a desktop has neither.
	 */
	it('leaves a touch screen to its own gesture', () => {
		expect(backPlacement('auto', TOUCH)).toBeUndefined();
		expect(backPlacement('auto', 1)).toBeUndefined();
	});

	it('draws one where there is no gesture', () => {
		expect(backPlacement('auto', MOUSE)).toBe('instead');
	});
});
