import { error, redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import { paneAfterExit } from '$lib/pane-exit';
import type { AgentDetail, WorkspaceNode } from '$lib/types';
import type { PageLoad } from './$types';

/** One boolean off one endpoint: narrow it rather than asserting a shape over it. */
async function readWatched(response: Response): Promise<boolean> {
	const body: unknown = await response.json();
	return typeof body === 'object' && body !== null && 'watched' in body && body.watched === true;
}

/** Carry the server's own reason instead of flattening every failure. */
async function failureMessage(response: Response): Promise<string> {
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
 *
 * The ETag is sent from the browser only. This module also runs on the server
 * for the first render, where a conditional fetch made the response inlined
 * into the page carry an `if-none-match` the browser's empty map could not
 * repeat — hydration missed it and fetched the transcript again. The server
 * still keeps its copy, so a reload during an outage holds the last transcript
 * instead of an error page.
 */
type Held = { detail: AgentDetail; watched: boolean; megabytes: number; etag: string };
const lastGood = new Map<string, Held>();

function heldResult(held: Held, megabytes: number, offline: boolean) {
	return { detail: held.detail, watched: held.watched, megabytes, offline };
}

/** A fetch that distinguishes "the server said no" from "there is no server". */
async function reach(run: typeof fetch, url: string, init?: RequestInit): Promise<Response | null> {
	try {
		return await run(url, init);
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
	const held = lastGood.get(params.pane);
	const [detail, watch] = await Promise.all([
		reach(
			fetch,
			`/api/agents/${encodeURIComponent(params.pane)}?bytes=${megabytes * 1024 * 1024}`,
			browser && held?.etag ? { headers: { 'if-none-match': held.etag } } : undefined
		),
		reach(fetch, `/api/agents/${encodeURIComponent(params.pane)}/watch`)
	]);

	// Unreachable, rather than refused. Keep what is on screen; the connection
	// indicator is what says the app has lost touch, not a blank error page.
	if (!detail) {
		if (held) return heldResult(held, megabytes, true);
		// Nothing to hold — this pane has never loaded — so there is genuinely
		// nothing to show and the error page is the honest answer.
		throw error(503, 'bordr is unreachable. The transcript will return when it is back.');
	}

	// A pane exiting is a navigation event, not an application error. Keep the
	// nearest surviving pane in the same tab when possible; otherwise use any
	// remaining pane, or the agents list when this was the last one.
	if (detail.status === 404) {
		let workspaces: WorkspaceNode[] = [];
		const panes = await reach(fetch, '/api/panes');
		if (panes?.ok) {
			const body: unknown = await panes.json().catch(() => null);
			if (
				typeof body === 'object' &&
				body !== null &&
				'workspaces' in body &&
				Array.isArray(body.workspaces)
			) {
				workspaces = body.workspaces as WorkspaceNode[];
			}
		}
		const next = paneAfterExit(workspaces, params.pane, held?.detail.tabId);
		redirect(303, next ? resolve('/a/[pane]', { pane: next }) : resolve('/'));
	}

	// A 5xx is the server being unwell, not an answer about this pane — herdr
	// restarting mid-request, or bordr itself redeployed under us. Same
	// treatment as unreachable: hold what was on screen rather than replacing a
	// live transcript and the draft in its composer with an error page.
	if (detail.status >= 500) {
		if (held) return heldResult(held, megabytes, true);
	}
	if (detail.status === 304 && held) {
		const watched = watch?.ok ? await readWatched(watch) : held.watched;
		const next = { ...held, watched, megabytes };
		lastGood.set(params.pane, next);
		return heldResult(next, megabytes, false);
	}
	if (!detail.ok) throw error(detail.status, await failureMessage(detail));
	// A failed watch lookup must not block the transcript; default to off and let
	// the next SSE-driven invalidation correct it.
	const watched = watch?.ok ? await readWatched(watch) : false;
	const data = {
		detail: (await detail.json()) as AgentDetail,
		watched,
		megabytes,
		etag: detail.headers.get('etag') ?? ''
	};
	lastGood.set(params.pane, data);
	return heldResult(data, megabytes, false);
};
