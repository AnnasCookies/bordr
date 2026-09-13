/**
 * A message's time, as a clock reads it.
 *
 * Separate from the component only because "what does a bad timestamp do" is
 * the part worth pinning down. The harness does not always write one — the
 * transcript's `at` is 0 when it said nothing — and a bubble stamped 01:00 on
 * 1 January 1970 is worse than a bubble with no stamp at all.
 */

/** Empty when there is no usable time, so the caller can render nothing. */
export function clockTime(at: number, locale?: string): string {
	if (!Number.isFinite(at) || at <= 0) return '';
	const when = new Date(at);
	if (Number.isNaN(when.getTime())) return '';
	return when.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}
