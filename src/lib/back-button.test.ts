import { describe, expect, it } from 'vitest';
import { backPlacement } from './back-button';

const TOUCH = 5;
const MOUSE = 0;

describe('backPlacement', () => {
	it('is nothing when switched off, whatever the device', () => {
		expect(backPlacement('off', TOUCH)).toBeUndefined();
		expect(backPlacement('off', MOUSE)).toBeUndefined();
	});

	it('keeps the mark when always on', () => {
		expect(backPlacement('on', TOUCH)).toBe('beside');
		expect(backPlacement('on', MOUSE)).toBe('beside');
	});

	/** The two go to the same place, so one of them may be dropped on purpose. */
	it('replaces the mark when asked to', () => {
		expect(backPlacement('only', TOUCH)).toBe('only');
		expect(backPlacement('only', MOUSE)).toBe('only');
	});

	/**
	 * The whole point of 'auto': a phone already has an edge swipe and a system
	 * button, and a desktop has neither.
	 */
	it('leaves a touch screen to its own gesture', () => {
		expect(backPlacement('auto', TOUCH)).toBeUndefined();
		expect(backPlacement('auto', 1)).toBeUndefined();
	});

	/**
	 * Beside the mark, not instead of it. `auto` only fires where there is no
	 * gesture — a desktop — which is the one place with room for both, so the
	 * narrow-header argument for dropping the mark does not apply here.
	 */
	it('draws one beside the mark where there is no gesture', () => {
		expect(backPlacement('auto', MOUSE)).toBe('beside');
	});
});
