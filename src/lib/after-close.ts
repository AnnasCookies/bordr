/**
 * Where to go once the pane you were reading has been closed.
 *
 * Closing what is on screen leaves the page pointed at something that no
 * longer exists: the next poll 404s and the transcript is replaced by an
 * error page for a pane somebody deliberately got rid of.
 *
 * The rule, in order:
 *
 *   1. the next pane in the SAME TAB, which is nearest to what was closed
 *   2. the next agent anywhere
 *   3. nothing — the caller sends you to the agents list
 *
 * Closing a TAB takes every pane in it, so none of them is a candidate and
 * step 1 is skipped entirely.
 */
export interface CloseContext {
	/** What was closed. */
	scope: 'pane' | 'tab' | 'workspace';
	/** The pane being read when it happened. */
	current: string;
	/** The panes in the current tab, in tab order. */
	siblings: readonly string[];
	/** Every agent, in list order. */
	all: readonly string[];
}

/** The pane to go to, or null for the agents list. */
export function afterClose({ scope, current, siblings, all }: CloseContext): string | null {
	const gone = scope === 'tab' ? new Set(siblings) : new Set([current]);
	// A closed tab takes its siblings with it, so only the wider list can
	// answer. A closed pane leaves the rest of its tab standing.
	const nearest = scope === 'pane' ? siblings : [];
	for (const list of [nearest, all]) {
		const next = list.find((paneId) => !gone.has(paneId));
		if (next) return next;
	}
	return null;
}
