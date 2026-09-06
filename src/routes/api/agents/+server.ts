import { json } from '@sveltejs/kit';
import { checkCompatibility, listAgents } from '$lib/server/herdr';
import { enrichAgents } from '$lib/server/enrich';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		// Enriched like the SSE projection: this route and the stream must not
		// disagree about what a row shows, or the list would change on refresh.
		const [listed, compat] = await Promise.all([listAgents(), checkCompatibility()]);
		return json({ agents: await enrichAgents(listed), compat });
	} catch (error) {
		// Rung 4 of the degradation ladder — herdr is unreachable.
		return json({ agents: [], error: (error as Error).message }, { status: 503 });
	}
};
