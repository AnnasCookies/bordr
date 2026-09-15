import type { BackTo } from './prefs.svelte';

/**
 * The phone's back gesture, decided in one place.
 *
 * With `backTo: 'home'` one back from anywhere returns to the agents list.
 * Getting there takes two rules, and both have to hold on every screen:
 *
 * 1. Leaving the agents list pushes one entry; every move after that REPLACES
 *    it. The conversation page did this on its own, but Files, Settings and
 *    Search did not, so four folders deep was five backs.
 * 2. A link back to the list steps back onto the entry that is already there
 *    instead of pushing a second copy. Replaced moves otherwise leave the
 *    list twice in the history, and the first back from it does nothing
 *    visible.
 */

/** Does a navigation from this path replace the history entry rather than push one? */
export function replacesHistory(backTo: BackTo, fromPath: string): boolean {
	return backTo === 'home' && fromPath !== '/';
}

export interface BackNavigation {
	type: string;
	from: string | null;
	to: string;
}

/**
 * Is the entry directly below the current one the agents list?
 *
 * Only a move from `/` puts it there, and replaced moves keep it. A cold start
 * (a notification opening a pane) has nothing below it at all.
 */
export function homeBelowAfter(
	previous: boolean,
	nav: BackNavigation,
	backTo: BackTo = 'home'
): boolean {
	if (nav.to === '/') return false;
	if (nav.type === 'enter' || nav.from === null) return false;
	if (nav.from === '/') return true;
	return previous && backTo === 'home' && (nav.type === 'link' || nav.type === 'goto');
}

/**
 * Should a navigation to the agents list step back instead of stacking a new entry?
 *
 * Only a plain `/`: a query such as `?shared=` is state the entry below does
 * not carry. Popstate is already a step back.
 */
export function stepsBackHome(
	backTo: BackTo,
	homeBelow: boolean,
	nav: BackNavigation & { search: string }
): boolean {
	if (backTo !== 'home' || !homeBelow) return false;
	if (nav.type !== 'link' && nav.type !== 'goto') return false;
	return nav.to === '/' && nav.search === '' && nav.from !== null && nav.from !== '/';
}
