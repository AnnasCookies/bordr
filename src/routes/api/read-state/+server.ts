import { error, json } from '@sveltejs/kit';
import { markRead, readState } from '$lib/server/state-store';
import { projector } from '$lib/server/projector';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(readState());

export const POST: RequestHandler = async ({ request }) => {
	const { paneId, seq } = (await request.json()) as { paneId?: string; seq?: number };
	if (!paneId || typeof seq !== 'number') throw error(400, 'paneId and seq required');
	markRead(paneId, seq);
	projector.poke(); // other devices clear the unread dot without waiting
	return json({ ok: true });
};
