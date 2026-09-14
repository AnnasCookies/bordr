import type { ChromeWhen } from './prefs.svelte';

/**
 * Whether one of the header's three controls is drawn here.
 *
 * Shared because five screens ask it, and a control that appears on some of
 * them and not others reads as a bug rather than as a setting.
 *
 * `touchPoints` rather than a viewport width: a narrow window on a desktop is
 * still a desktop, and a tablet in landscape is still a touch screen.
 */
export function showChrome(when: ChromeWhen, touchPoints: number): boolean {
	if (when === 'off') return false;
	if (when === 'always') return true;
	return touchPoints > 0;
}

/**
 * Whether the back arrow is drawn, given where it would go.
 *
 * Never on the page it points at: on the agents list a ← to `/` is a control
 * that reloads the screen you are already looking at.
 *
 * The drawer asks this too. It is drawn over the header and has to leave the
 * arrow's width free in front of its own ☰, or that ☰ is no longer where the
 * header's was — so the two must never answer differently.
 */
export function showBackArrow(
	when: ChromeWhen,
	touchPoints: number,
	here: string,
	target: string
): boolean {
	if (here === target) return false;
	return showChrome(when, touchPoints);
}

/** What the browser reports, with a sane answer before hydration. */
export function touchPoints(): number {
	// 1, not 0, on the server: a mobile-only control that flashes in and out on
	// every desktop load is worse than one that appears a frame late.
	return typeof navigator === 'undefined' ? 1 : navigator.maxTouchPoints;
}
