import { describe, expect, it } from 'vitest';
import { clockTime } from './clock-time';

describe('clockTime', () => {
	it('reads as a clock', () => {
		const at = Date.UTC(2026, 0, 2, 14, 7);
		expect(clockTime(at, 'auto', 'en-GB')).toBe('14:07');
	});

	/**
	 * Each clock padded the way it is actually written. `2-digit` everywhere
	 * gives "05:22 PM"; `numeric` everywhere gives a 24-hour "5:22" that will
	 * not line up under "17:22". Neither is right for both.
	 */
	it('pads a 24-hour clock and leaves a 12-hour one alone', () => {
		const morning = Date.UTC(2026, 0, 2, 5, 22);
		expect(clockTime(morning, 'auto', 'en-GB')).toBe('05:22');
		expect(clockTime(Date.UTC(2026, 0, 2, 17, 22), 'auto', 'en-GB')).toBe('17:22');
		expect(clockTime(morning, 'auto', 'en-US')).toMatch(/^5:22\s?AM$/);
	});

	/** The override wins over the locale, in both directions. */
	it('forces the clock when one is chosen', () => {
		const evening = Date.UTC(2026, 0, 2, 17, 22);
		expect(clockTime(evening, 'h24', 'en-US')).toBe('17:22');
		expect(clockTime(evening, 'h12', 'en-GB')).toMatch(/^5:22\s?pm$/i);
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
