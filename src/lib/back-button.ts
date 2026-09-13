/**
 * Whether a screen draws an explicit way back to the agents list, and how.
 *
 * Shared because two screens ask it — a conversation and settings — and the
 * answer has to be the same on both. A setting that showed an arrow on one of
 * them reads as a bug rather than a choice.
 *
 * 'auto' means "where there is nothing else to fall back on". A touch screen
 * has an edge swipe and a system button; a desktop has neither, and the mark
 * in the header reads as a logo rather than as a control.
 */
import type { BackButton } from './prefs.svelte';

/** Where the arrow sits, or undefined for no arrow at all. */
export type BackPlacement = 'only' | 'beside' | undefined;

export function backPlacement(mode: BackButton, touchPoints: number): BackPlacement {
	if (mode === 'off') return undefined;
	if (mode === 'only') return 'only';
	if (mode === 'on') return 'beside';
	// `touchPoints` rather than a viewport width: a narrow window on a desktop
	// is still a desktop, and a tablet in landscape still swipes.
	//
	// Beside the mark, not instead of it: this fires only where there is no
	// gesture, which is a desktop, which is the one place with room for both.
	return touchPoints > 0 ? undefined : 'beside';
}
