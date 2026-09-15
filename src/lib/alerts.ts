import type { AgentStatus } from './types';
import type { Chime } from './chime';

/** What a pref of this name allows through. */
export type SoundAlerts = 'off' | 'attention' | 'all';

/**
 * Which agents just changed into a state worth a noise.
 *
 * Compares two snapshots of the agent list rather than listening for events:
 * the list arrives whole over SSE, so a transition is the difference between
 * what was there and what is there now. Anything absent from `before` is not
 * a transition — it is the first snapshot after opening the app, and every
 * idle agent in it would otherwise chime at once.
 */
export function alertsFor(
	before: Map<string, AgentStatus>,
	after: Array<{ paneId: string; status: AgentStatus }>,
	setting: SoundAlerts
): Chime[] {
	if (setting === 'off') return [];
	const out: Chime[] = [];
	for (const agent of after) {
		const was = before.get(agent.paneId);
		// Never seen before: the first list, a new pane, or one that was
		// filtered out. Not a change, so not a sound.
		if (was === undefined) continue;
		if (was === agent.status) continue;
		if (agent.status === 'blocked') out.push('attention');
		else if (agent.status === 'done' && setting === 'all') out.push('done');
	}
	return out;
}

/** The snapshot to compare the next list against. */
export function snapshot(
	agents: Array<{ paneId: string; status: AgentStatus }>
): Map<string, AgentStatus> {
	return new Map(agents.map((a) => [a.paneId, a.status]));
}
