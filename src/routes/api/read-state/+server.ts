import { error, json } from '@sveltejs/kit';
import { markRead, readScopeFor, readState } from '#lib/server/state-store.js';
import { parsePane } from '#lib/server/herdr/address.js';
import { projector } from '#lib/server/projector.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(readState());

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON');
	}
	const { paneId, seq, scope } = (body ?? {}) as {
		paneId?: unknown;
		seq?: unknown;
		scope?: unknown;
	};
	if (
		typeof paneId !== 'string' ||
		!paneId ||
		paneId.length > 200 ||
		typeof seq !== 'number' ||
		!Number.isSafeInteger(seq) ||
		seq < 0
	)
		throw error(400, 'paneId and a non-negative integer seq required');
	if (scope !== undefined && typeof scope !== 'string') throw error(400, 'invalid read scope');
	if (parsePane(paneId).machineId && typeof scope !== 'string')
		throw error(400, 'remote read scope required');
	if (scope !== undefined && scope !== readScopeFor(paneId))
		throw error(409, 'the pane target changed before it could be marked read');
	try {
		markRead(paneId, seq, scope as string | undefined);
	} catch (cause) {
		console.error('bordr: read state could not be saved', cause);
		throw error(503, 'read state could not be saved');
	}
	projector.poke(); // other devices clear the unread dot without waiting
	return json({ ok: true });
};
