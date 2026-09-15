/**
 * Should the transcript still be following the end?
 *
 * Pulled out of the page because getting it wrong is invisible in a diff and
 * obvious in the hand: the old rule recomputed it from the scroll position on
 * every event, which is wrong in both directions. The transcript growing
 * moves the bottom away without the reader moving at all — so following
 * turned itself off, the jump button appeared while you were sitting at the
 * end, and the automatic scroll put you back. That is the jitter.
 *
 * The rule is about INTENT, and only two things express it:
 *
 *   scrolling up      stop following
 *   reaching the end  follow again
 *
 * Everything else — a poll, a new turn, the soft keyboard, a resize, an
 * automatic scroll of our own — leaves the reader's decision alone.
 */

export interface ScrollMoment {
	/** Where the scroller is now. */
	top: number;
	/** Where it was when we last looked. */
	lastTop: number;
	/** Within a few pixels of the end. */
	atBottom: boolean;
	/** True when this scroll was one we caused, not one the reader made. */
	programmatic: boolean;
}

/**
 * A few pixels of slack, so a trackpad's jitter or a sub-pixel layout shift
 * is not read as a deliberate scroll up.
 */
const UP_SLACK = 4;

export function nextFollowing(following: boolean, moment: ScrollMoment): boolean {
	const { top, lastTop, atBottom, programmatic } = moment;
	// Our own scroll is not the reader changing their mind, however far it
	// moves — but if it landed at the end, that is still the end.
	if (!programmatic && top < lastTop - UP_SLACK) return false;
	if (atBottom) return true;
	return following;
}
