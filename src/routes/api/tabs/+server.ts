import { error, json } from '@sveltejs/kit';
import { clientFor, HerdrRequestError } from '$lib/server/herdr';
import { formatPane, parsePane } from '$lib/server/herdr/address';
import type { RequestHandler } from './$types';

/**
 * A new tab in an existing workspace — herdr's `+` on the tab bar.
 *
 * `tab.create` opens the tab with a shell in it and hands back its root pane,
 * so there is nothing to poll for: the response carries where to go.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { workspaceId } = (await request.json()) as { workspaceId?: string };
	if (!workspaceId) throw error(400, 'workspaceId is required');

	// The workspace address carries its machine, so a tab opens on the host
	// the workspace actually lives on rather than always on this one.
	const { machineId, paneId: bare } = parsePane(workspaceId);

	try {
		const herdr = await clientFor(machineId);
		const created = await herdr.request<{ root_pane?: { pane_id?: string } }>('tab.create', {
			workspace_id: bare
		});
		const pane = created.root_pane?.pane_id;
		if (!pane) throw error(500, 'tab.create returned no pane');
		return json({ ok: true, paneId: formatPane(machineId, pane) });
	} catch (e) {
		if (e instanceof HerdrRequestError) throw error(409, e.message);
		if (e instanceof Error && !('status' in e)) {
			throw error(503, `herdr is not reachable: ${e.message}`);
		}
		throw e;
	}
};
