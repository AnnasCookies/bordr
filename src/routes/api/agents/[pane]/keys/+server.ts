import { error, json } from '@sveltejs/kit';
import { getClient, HerdrRequestError } from '$lib/server/herdr';
import { validateKeys } from './validate';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const body = (await request.json()) as { keys?: unknown };
	let keys: string[];
	try {
		keys = validateKeys(body.keys);
	} catch (e) {
		throw error(400, (e as Error).message);
	}
	try {
		await getClient().request('agent.send_keys', { target: params.pane, keys });
	} catch (e) {
		// Same mapping as the prompt route: a refusal is the caller's problem
		// (409, with herdr's reason); a dead socket is the server's (503).
		if (e instanceof HerdrRequestError) throw error(409, e.message);
		if (e instanceof Error) throw error(503, `herdr is not reachable: ${e.message}`);
		throw e;
	}
	return json({ ok: true });
};
