import { describe, expect, it } from 'vitest';
import { clockTime } from './clock-time';

describe('clockTime', () => {
	it('reads as a clock', () => {
		const at = Date.UTC(2026, 0, 2, 14, 7);
		expect(clockTime(at, 'en-GB')).toBe('14:07');
	});

	/**
	 * The whole reason this is a function. `Message.at` is 0 whenever the
	 * harness wrote no timestamp, and a bubble stamped 01:00 on 1 January 1970
	 * is worse than a bubble with no stamp at all — empty lets the caller
	 * render nothing.
	 */
	it('is empty rather than 1970 when the harness said nothing', () => {
		expect(clockTime(0)).toBe('');
	});

	it('is empty for a time that is not one', () => {
		expect(clockTime(Number.NaN)).toBe('');
		expect(clockTime(-1)).toBe('');
		expect(clockTime(Number.POSITIVE_INFINITY)).toBe('');
	});
});
