/**
 * Whether the Latest glide must give the page back to the reader this frame.
 *
 * The glide writes the scroll position every animation frame and holds
 * `programmatic` for its whole run, so nothing the reader did could stop it:
 * a thumb on the glass or a flick back up was overwritten on the next frame,
 * and a transcript growing under it restarted the trip. A glide is a
 * courtesy, and it ends the moment the reader takes over — or the moment the
 * page it was scrolling is no longer the page on screen.
 */

/**
 * How far above the last written position counts as the reader moving.
 * The same slack `nextFollowing` allows: sub-pixel rounding of a written
 * scrollTop is not a scroll up.
 */
export const GLIDE_UP_SLACK = 4;

export interface GlideFrame {
	/** This conversation is still the page on screen. */
	live: boolean;
	/** A finger is on the transcript. */
	touching: boolean;
	/** Where the scroller is now. */
	top: number;
	/** Where the glide last put it, read back; null before the first write. */
	written: number | null;
}

export function glideInterrupted({ live, touching, top, written }: GlideFrame): boolean {
	if (!live || touching) return true;
	return written !== null && top < written - GLIDE_UP_SLACK;
}
