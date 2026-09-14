import { error } from '@sveltejs/kit';
import type { AgentDetail } from '$lib/types';
import type { PageLoad } from './$types';

/** One boolean off one endpoint: narrow it rather than asserting a shape over it. */
async function readWatched(response: Response): Promise<boolean> {
	const body: unknown = await response.json();
	return typeof body === 'object' && body !== null && 'watched' in body && body.watched === true;
}

/**
 * Only a 404 is "not found". Anything else carries the server's own reason
 * — herdr down, a protocol mismatch — and the error page shows it verbatim,
 * which used to be flattened into "agent not found" for every status.
 */
async function failureMessage(response: Response): Promise<string> {
	if (response.status === 404) return 'agent not found';
	const body: unknown = await response.json().catch(() => null);
	if (
		typeof body === 'object' &&
		body !== null &&
		'message' in body &&
		typeof body.message === 'string' &&
		body.message.length > 0
	) {
		return body.message;
	}
	return `bordr returned ${response.status} for this agent`;
}

/**
 * The last payload that actually arrived, per pane.
 *
 * A `fetch` that fails at the network layer THROWS rather than returning a
 * status, so a moment without signal rejected this load and SvelteKit put a
 * 500 page over the whole app — the transcript, the composer and any draft in
 * it, gone, because a phone went through a tunnel. The poll that drives this
 * runs every few seconds, so it happened constantly on a weak connection.
 *
 * Holding the last good payload turns that into nothing at all: the screen
 * stays exactly as it was and the connection dot goes red. Per pane and never
 * evicted — it is one transcript each for the panes visited this session, and
 * a reload clears it.
 */
const lastGood = new Map<string, { detail: AgentDetail; watched: boolean; megabytes: number }>();

/** A fetch that distinguishes "the server said no" from "there is no server". */
async function reach(run: typeof fetch, url: string): Promise<Response | null> {
	try {
		return await run(url);
	} catch {
		return null;
	}
}

export const load: PageLoad = async ({ params, url, fetch }) => {
	// How far back to read, in MiB. It lives in the URL so that the SSE-driven
	// invalidateAll re-runs this load with the reader's widened window intact —
	// component state would be reset by the next refresh, snapping them back to
	// the last screenful mid-scroll.
	const requested = Number(url.searchParams.get('w'));
	const megabytes = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 1;

	// Both requests in flight together. The watch flag seeds the header bell:
	// without it the bell renders 🔕 for a pane the server is really watching,
	// and the first tap then re-arms an existing watch instead of clearing it.
	const [detail, watch] = await Promise.all([
		reach(fetch, `/api/agents/${encodeURIComponent(params.pane)}?bytes=${megabytes * 1024 * 1024}`),
		reach(fetch, `/api/agents/${encodeURIComponent(params.pane)}/watch`)
	]);

	// Unreachable, rather than refused. Keep what is on screen; the connection
	// indicator is what says the app has lost touch, not a blank error page.
	if (!detail) {
		const held = lastGood.get(params.pane);
		if (held) return { ...held, megabytes, offline: true };
		// Nothing to hold — this pane has never loaded — so there is genuinely
		// nothing to show and the error page is the honest answer.
		throw error(503, 'bordr is unreachable. The transcript will return when it is back.');
	}

	if (!detail.ok) throw error(detail.status, await failureMessage(detail));
	// A failed watch lookup must not block the transcript; default to off and let
	// the next SSE-driven invalidation correct it.
	const watched = watch?.ok ? await readWatched(watch) : false;
	const data = { detail: (await detail.json()) as AgentDetail, watched, megabytes };
	lastGood.set(params.pane, data);
	return { ...data, offline: false };
};
