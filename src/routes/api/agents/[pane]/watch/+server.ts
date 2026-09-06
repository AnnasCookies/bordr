import { error, json } from '@sveltejs/kit';
import { setWatched, watchedPanes } from '$lib/server/state-store';
import type { RequestHandler } from './$types';

/**
 * Arm or clear this pane's done-watch. Persistent, not one-shot: every done
 * transition pushes until the pane is unwatched — see `isWatched` and the
 * "survives being checked" case in state-store.test.ts.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const { watched } = (await request.json()) as { watched?: boolean };
	if (typeof watched !== 'boolean') throw error(400, 'watched required');
	setWatched(params.pane, watched);
	return json({ ok: true, watched });
};

export const GET: RequestHandler = async ({ params }) =>
	json({ watched: watchedPanes().includes(params.pane) });
