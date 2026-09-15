/**
 * When an error page should try again by itself, and how often.
 *
 * A phone on a tailnet loses the server constantly — a tunnel, a lift, the
 * host restarting after a deploy. bordr already keeps the last transcript on
 * screen through that, but a pane you have never opened has nothing to hold,
 * so it lands on the error page. That page was terminal: its only way out was
 * "Back to agents", which fails the same way while the server is still down,
 * so the app sat dead until someone thought to pull-to-refresh.
 *
 * The logic is here rather than in the component because "which failures are
 * worth retrying" is the part that has to be right. Retrying a 404 for ever
 * is a page that lies about being busy; not retrying a 503 is the dead end
 * this exists to remove.
 */

/**
 * Is this failure the kind that fixes itself?
 *
 *   5xx  the server is there but unwell, or came back mid-request
 *   0    no status at all — the fetch never reached anything
 *   408  the request timed out
 *   429  asked to slow down, which is a yes with a wait attached
 *
 * A 4xx is not: 404 means the pane is gone and will not return, and 403 will
 * not change by asking again. Those want a person, not a timer.
 */
export function recoverable(status: number): boolean {
	if (status === 0 || status === 408 || status === 429) return true;
	return status >= 500 && status < 600;
}

export const FIRST_WAIT_MS = 2_000;
export const MAX_WAIT_MS = 30_000;

/**
 * How long before the next attempt, given how many have already failed.
 *
 * Doubling, capped. The cap matters more than the curve: this runs on a
 * phone that may be in a pocket for an hour, and a page that keeps a request
 * every two seconds for that long is a flat battery, while one that has
 * backed off to ten minutes is not there when you look at it.
 */
export function waitFor(attempt: number): number {
	const wait = FIRST_WAIT_MS * 2 ** Math.max(0, attempt);
	return Math.min(wait, MAX_WAIT_MS);
}
