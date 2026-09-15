/**
 * How many requests this page is waiting on.
 *
 * `:active` already answers the tap itself — the browser paints it before it
 * has asked the network anything. What it cannot answer is the gap between
 * letting go and the server replying, which on a slow link is where a tap
 * looks like it did nothing and gets repeated. A repeated tap on an answer
 * is not a cosmetic problem: it is a second keystroke sent to a terminal.
 *
 * Two layers cover that gap. The control that was tapped shows a spinner in
 * place of its own icon, which is the precise feedback; this counter is the
 * fallback, driving the same top bar a navigation uses, so a request from a
 * control nobody thought to decorate still says something is happening.
 */

let count = $state(0);

export const netBusy = {
	get active() {
		return count > 0;
	}
};

/**
 * Run a request and count it while it is in flight.
 *
 * Rethrows, and decrements in a `finally`: a failed request that left the
 * counter up would pin the progress bar on for the life of the page.
 */
export async function track<T>(run: () => Promise<T>): Promise<T> {
	count += 1;
	try {
		return await run();
	} finally {
		count -= 1;
	}
}

/** Test seam: forget anything still counted. */
export function resetPending(): void {
	count = 0;
}
