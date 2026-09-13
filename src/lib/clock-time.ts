/**
 * A message's time, as a clock reads it.
 *
 * Separate from the component only because "what does a bad timestamp do" is
 * the part worth pinning down. The harness does not always write one — the
 * transcript's `at` is 0 when it said nothing — and a bubble stamped 01:00 on
 * 1 January 1970 is worse than a bubble with no stamp at all.
 */

/** 'auto' follows the device; the other two override it. */
export type ClockChoice = 'auto' | 'h24' | 'h12';

/** Empty when there is no usable time, so the caller can render nothing. */
export function clockTime(at: number, choice: ClockChoice = 'auto', locale?: string): string {
	if (!Number.isFinite(at) || at <= 0) return '';
	const when = new Date(at);
	if (Number.isNaN(when.getTime())) return '';
	const hour12 = choice === 'auto' ? twelveHour(locale) : choice === 'h12';
	// The hour is padded on a 24-hour clock and not on a 12-hour one, because
	// that is how each is actually written: "05:22" and "17:22" line up in a
	// column, while "05:22 PM" is a padding no clock anywhere uses. Neither
	// option is right for both, so the clock in use decides.
	return when.toLocaleTimeString(locale, {
		hour: hour12 ? 'numeric' : '2-digit',
		minute: '2-digit',
		hour12
	});
}

/** Whether this locale writes AM/PM. Undefined means the runtime declined to say. */
function twelveHour(locale?: string): boolean {
	try {
		return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 === true;
	} catch {
		return false;
	}
}
