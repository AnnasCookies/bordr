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
		fetch(`/api/agents/${params.pane}?bytes=${megabytes * 1024 * 1024}`),
		fetch(`/api/agents/${params.pane}/watch`)
	]);
	if (!detail.ok) throw error(detail.status, await failureMessage(detail));
	// A failed watch lookup must not block the transcript; default to off and let
	// the next SSE-driven invalidation correct it.
	const watched = watch.ok ? await readWatched(watch) : false;
	return { detail: (await detail.json()) as AgentDetail, watched, megabytes };
};
