import { error, json } from '@sveltejs/kit';
import { rawAgent } from '$lib/server/herdr';
import { commandsFor } from '$lib/server/commands';
import type { RequestHandler } from './$types';

/** The slash commands this pane's harness knows, for the composer's `/` list. */
export const GET: RequestHandler = async ({ params }) => {
	let raw: Awaited<ReturnType<typeof rawAgent>>;
	try {
		raw = await rawAgent(params.pane);
	} catch (e) {
		throw error(503, `herdr is not reachable: ${e instanceof Error ? e.message : String(e)}`);
	}
	if (!raw) throw error(404, `no agent in pane ${params.pane}`);
	const commands = await commandsFor(String(raw.agent ?? ''), String(raw.cwd ?? ''));
	return json({ agent: raw.agent, commands });
};
