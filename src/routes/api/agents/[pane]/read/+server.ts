import { error, json } from '@sveltejs/kit';
import { HerdrRequestError, readPane } from '$lib/server/herdr';
import { cleanSnapshot } from '$lib/server/snapshot';
import type { RequestHandler } from './$types';

const MAX_LINES = 20_000;

/**
 * Paginated scrollback for the snapshot fallback and the keypad peek.
 *
 * The `visible` source is a single screenful, so without this you are blind
 * above the fold on any harness without a transcript adapter.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	// A negative value reached herdr and came back a 500; zero and NaN fell
	// through to the default only by accident of `||`. Clamp explicitly.
	const requested = Number(url.searchParams.get('lines') ?? 200);
	const lines =
		Number.isFinite(requested) && requested >= 1 ? Math.min(Math.floor(requested), MAX_LINES) : 200;
	const ansi = url.searchParams.get('ansi') === '1';

	try {
		const raw = await readPane(params.pane, { source: 'recent_unwrapped', lines, ansi });
		const text = ansi ? raw : cleanSnapshot(raw);
		return json({ text, lines, atTop: text.split('\n').length < lines });
	} catch (e) {
		// herdr refuses deep scrollback while an agent holds the alternate
		// screen (agent_not_idle). Fall back to the visible screenful rather
		// than showing nothing — the common case for a busy agent.
		if (e instanceof HerdrRequestError && e.code === 'agent_not_idle') {
			const raw = await readPane(params.pane, { source: 'visible', ansi });
			const text = ansi ? raw : cleanSnapshot(raw);
			return json({ text, lines: text.split('\n').length, atTop: true, limited: true });
		}
		if (e instanceof HerdrRequestError) throw error(409, e.message);
		if (e instanceof Error) throw error(503, `herdr is not reachable: ${e.message}`);
		throw e;
	}
};
