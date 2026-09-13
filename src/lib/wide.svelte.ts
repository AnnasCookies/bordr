/**
 * Is the window wide enough for the desktop layout — a session tree beside
 * the content instead of behind a drawer?
 *
 * One definition, shared. Two pages switch on this now, and a second copy of
 * `matchMedia('(min-width: 1024px)')` is a breakpoint waiting to drift from
 * the `lg:` classes it has to agree with: the query and Tailwind's `lg` are
 * the same 1024px, and nothing would tell you if one of them moved.
 *
 * It starts false and is synced from an effect rather than read at import,
 * so the server and the first client render agree. A desktop corrects itself
 * on mount, which is what the conversation has always done.
 */

const LG = '(min-width: 1024px)';

/**
 * Below this, the conversation header has no room for its secondary actions.
 *
 * Measured on a real pane: at 430px the controls take 365px of the row and
 * the pane's own TITLE is left with 13 pixels; at 360 and 320 it gets none at
 * all. The title is the one thing on that row you cannot work out from
 * anything else, so the toggles give way instead and move into the ⋯ sheet.
 *
 * 600px rather than `sm`: a phone in landscape is still a phone, and a tablet
 * has the room.
 */
const TIGHT = '(max-width: 599px)';

let matches = $state(false);
let narrow = $state(false);
let query: MediaQueryList | null = null;
let tightQuery: MediaQueryList | null = null;
let watchers = 0;

const sync = () => {
	matches = query?.matches ?? false;
	narrow = tightQuery?.matches ?? false;
};

/**
 * Start following the breakpoint. Call from an `$effect` and return the
 * teardown, so a page that unmounts stops listening.
 *
 * Counted, because both the list and a conversation can be alive at once
 * during a navigation and the second one must not tear off the first one's
 * listener.
 */
export function watchWide(): () => void {
	if (typeof window === 'undefined') return () => {};
	if (watchers++ === 0) {
		query = window.matchMedia(LG);
		tightQuery = window.matchMedia(TIGHT);
		sync();
		query.addEventListener('change', sync);
		tightQuery.addEventListener('change', sync);
	}
	return () => {
		if (--watchers === 0 && query && tightQuery) {
			query.removeEventListener('change', sync);
			tightQuery.removeEventListener('change', sync);
			query = null;
			tightQuery = null;
			matches = false;
			narrow = false;
		}
	};
}

/** Read-only for components: `screen.wide`. */
export const screen = {
	get wide() {
		return matches;
	},
	/** Too narrow for the header's secondary actions to sit beside the title. */
	get tight() {
		return narrow;
	}
};

/** Test seam: set the breakpoints without a window. */
export function setWideForTest(value: boolean, alsoTight = false): void {
	matches = value;
	narrow = alsoTight;
}
