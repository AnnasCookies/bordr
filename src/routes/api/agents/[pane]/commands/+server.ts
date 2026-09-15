import { error, json } from '@sveltejs/kit';
import { rawAgent } from '$lib/server/herdr';
import { parsePane } from '$lib/server/herdr/address';
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
	// A remote pane's cwd is a path on that machine, reported by that machine;
	// see `CommandOptions.remote` for why it must not steer anything here.
	const { machineId } = parsePane(params.pane);
	const commands = await commandsFor(String(raw.agent ?? ''), String(raw.cwd ?? ''), {
		remote: machineId !== ''
	});
	return json({ agent: raw.agent, commands });
};
