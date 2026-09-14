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

let matches = $state(false);
let query: MediaQueryList | null = null;
let watchers = 0;

const sync = () => {
	matches = query?.matches ?? false;
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
		sync();
		query.addEventListener('change', sync);
	}
	return () => {
		if (--watchers === 0 && query) {
			query.removeEventListener('change', sync);
			query = null;
			matches = false;
		}
	};
}

/** Read-only for components: `screen.wide`. */
export const screen = {
	get wide() {
		return matches;
	}
};

/** Test seam: set the breakpoint without a window. */
export function setWideForTest(value: boolean): void {
	matches = value;
}
