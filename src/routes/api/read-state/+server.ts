import { error, json } from '@sveltejs/kit';
import { markRead, readState } from '$lib/server/state-store';
import { projector } from '$lib/server/projector';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(readState());

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON');
	}
	const { paneId, seq } = (body ?? {}) as { paneId?: unknown; seq?: unknown };
	if (
		typeof paneId !== 'string' ||
		!paneId ||
		paneId.length > 200 ||
		typeof seq !== 'number' ||
		!Number.isSafeInteger(seq) ||
		seq < 0
	)
		throw error(400, 'paneId and a non-negative integer seq required');
	try {
		markRead(paneId, seq);
	} catch (cause) {
		console.error('bordr: read state could not be saved', cause);
		throw error(503, 'read state could not be saved');
	}
	projector.poke(); // other devices clear the unread dot without waiting
	return json({ ok: true });
};
