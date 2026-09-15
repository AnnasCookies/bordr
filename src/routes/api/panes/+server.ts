import { json } from '@sveltejs/kit';
import { paneTree } from '$lib/server/herdr/tree';
import { machineStates } from '$lib/server/herdr/connections';
import { knownMachineLabels } from '$lib/server/herdr/machines';
import type { RequestHandler } from './$types';

/**
 * The session tree, for the desktop sidebar.
 *
 * Separate from /api/agents rather than folded into it: the phone's list is
 * about agents that need you, and adding every shell pane to it would bury
 * that. This endpoint answers a different question — what is open.
 */
export const GET: RequestHandler = async () => {
	// Machines are informational: herdr's socket has no machine concept, so
	// bordr serves this host's panes and can only name the others.
	const machines = machineStates();
	// herdr knows hosts bordr has not been allowed to reach: say so, rather
	// than leaving a sidebar that quietly omits the machines you use daily.
	// Names only — nothing here is connected to.
	const offered = machines.length === 0 ? knownMachineLabels() : [];
	return json({ workspaces: await paneTree(), machines, offered });
};
