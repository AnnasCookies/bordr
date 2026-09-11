import { error, json } from '@sveltejs/kit';
import { clientFor, HerdrRequestError } from '$lib/server/herdr';
import { parsePane } from '$lib/server/herdr/address';
import type { RequestHandler } from './$types';

/**
 * Move a split, for real.
 *
 * The divider in the desktop split view is not a bordr-only affordance: this
 * is herdr's own `layout.set_split_ratio`, so a drag here resizes the panes in
 * the terminal too, and the next poll reads the new ratio back.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { tabId, path, ratio } = (await request.json()) as {
		tabId?: string;
		path?: unknown;
		ratio?: number;
	};
	if (!tabId) throw error(400, 'tabId is required');
	if (!Array.isArray(path) || path.some((step) => typeof step !== 'boolean')) {
		throw error(400, 'path must be an array of booleans');
	}
	// A ratio outside this leaves a pane with no width at all, which herdr will
	// happily do and no one can undo by dragging.
	if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0.05 || ratio > 0.95) {
		throw error(400, 'ratio must be between 0.05 and 0.95');
	}

	const { machineId, paneId: bareTab } = parsePane(tabId);
	try {
		const herdr = await clientFor(machineId);
		// The tab is named so the caller cannot silently resize whichever tab
		// herdr happens to have focused, which is what the pane methods do.
		await herdr.request('layout.set_split_ratio', { tab_id: bareTab, path, ratio });
		return json({ ok: true });
	} catch (e) {
		if (e instanceof HerdrRequestError) throw error(409, e.message);
		if (e instanceof Error && !('status' in e)) {
			throw error(503, `herdr is not reachable: ${e.message}`);
		}
		throw e;
	}
};
