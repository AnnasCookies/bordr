import { json } from '@sveltejs/kit';
import { paneTree } from '$lib/server/herdr/tree';
import type { RequestHandler } from './$types';

/**
 * The session tree, for the desktop sidebar.
 *
 * Separate from /api/agents rather than folded into it: the phone's list is
 * about agents that need you, and adding every shell pane to it would bury
 * that. This endpoint answers a different question — what is open.
 */
export const GET: RequestHandler = async () => {
	return json({ workspaces: await paneTree() });
};
