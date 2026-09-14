import type { AgentStatus, AgentSummary } from '$lib/types';
import type { GroupBy, SortBy } from '$lib/prefs.svelte';

/** Order statuses appear in the rollup and in status grouping. */
export const STATUS_ORDER: AgentStatus[] = ['blocked', 'working', 'done', 'idle', 'unknown'];

/** Grouping order excludes blocked — those are pinned above every group. */
const GROUPED_STATUSES = STATUS_ORDER.filter((s) => s !== 'blocked');

export interface AgentGroup {
	key: string;
	/** Left-hand label, in the group header. */
	left: string;
	/** Right-hand label: cwd for workspaces, empty otherwise. */
	right: string;
	/** Status or harness this group is keyed on, for colouring the header. */
	status?: AgentStatus;
	agent?: string;
	agents: AgentSummary[];
}

/**
 * Collapse a home directory to `~`.
 *
 * The pane's cwd arrives absolute and the client has no `$HOME`. Both
 * platforms bordr targets put home under a two-segment root, so match that
 * shape rather than guessing at a common prefix across panes — a single agent
 * running outside home would otherwise poison the guess for every row.
 */
export function collapseHome(cwd: string): string {
	return cwd.replace(/^\/(?:home|Users)\/[^/]+/, '~');
}

/**
 * A pane's terminal title is still the shell's.
 *
 * A harness renames the terminal when it starts, so a title is normally the
 * work — "ctxc #11403". Some never do, or have not yet: an idle agy sits under
 * `tony@tm-work:~` and reads as a stray terminal in a list of agents. The
 * shapes below are what a shell writes and no harness would: `user@host:path`,
 * a bare path, and the empty title of a pane that has written nothing.
 */
const SHELL_TITLE = /^(?:[\w.-]+@[\w.-]+(?::.*)?|~(?:\/.*)?|\/.*)$/;

/**
 * What to call an agent whose terminal still carries the shell's title —
 * its workspace, which is at least the work it belongs to.
 */
export function agentTitle(
	title: string,
	workspaceLabel: string,
	paneId: string,
	agent = ''
): string {
	const named = title.trim();
	if (named && !SHELL_TITLE.test(named)) return named;
	// A workspace can be shell-shaped too: an agent started in home sits in a
	// workspace called `~`, so falling back to it just repeats the problem.
	const workspace = workspaceLabel.trim();
	if (workspace && !SHELL_TITLE.test(workspace)) return workspace;
	// The harness at least says what the row IS. The pane id, not the shell
	// title, when even that is missing: `~` identifies nothing.
	return agent.trim() || paneId;
}

const byTitle = (a: AgentSummary, b: AgentSummary) =>
	(a.title || a.paneId).localeCompare(b.title || b.paneId, 'en');

export function sortAgents(agents: AgentSummary[], sort: SortBy): AgentSummary[] {
	const list = [...agents];
	if (sort === 'title') return list.sort(byTitle);
	// Highest seq first: the pane that changed most recently is the one you
	// are most likely to want.
	if (sort === 'recent') return list.sort((a, b) => b.seq - a.seq || byTitle(a, b));
	return list.sort(
		(a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || byTitle(a, b)
	);
}

/**
 * Split the list into the pinned "needs you" set and the groups below it.
 *
 * Blocked panes are removed from the groups they would otherwise fall into, so
 * an agent waiting on you appears exactly once however the list is grouped.
 *
 * Blocked panes are also exempt from the badge filter. The filter is
 * persisted, so one left lit from yesterday would otherwise hide an agent
 * that is waiting on you right now — and the service worker's summary
 * notification opens `/` precisely because blocked agents are pinned to the
 * top of it. A filter narrows the groups; it never hides a question.
 */
export function partitionAgents(
	agents: AgentSummary[],
	groupBy: GroupBy,
	sort: SortBy,
	filter: ListFilter | null = null
): { blocked: AgentSummary[]; groups: AgentGroup[] } {
	const blocked = sortAgents(
		agents.filter((a) => a.status === 'blocked'),
		sort
	);
	// Narrowed here rather than at the caller, so every reader of the list —
	// the page, and the conversation's swipe order — sees the same rows.
	const rest = agents.filter(
		(a) => a.status !== 'blocked' && (filter === null || matchesFilter(a, filter))
	);

	if (groupBy === 'none') {
		return {
			blocked,
			groups: rest.length
				? [{ key: 'all', left: '', right: '', agents: sortAgents(rest, sort) }]
				: []
		};
	}

	if (groupBy === 'status') {
		const groups = GROUPED_STATUSES.map((status) => {
			const list = rest.filter((a) => a.status === status);
			return {
				key: status,
				left: `${status} · ${list.length}`,
				right: '',
				status,
				agents: sortAgents(list, sort)
			};
		}).filter((g) => g.agents.length > 0);
		return { blocked, groups };
	}

	if (groupBy === 'harness') {
		const names = [...new Set(rest.map((a) => a.agent))].sort((a, b) => a.localeCompare(b, 'en'));
		const groups = names.map((agent) => {
			const list = rest.filter((a) => a.agent === agent);
			return {
				key: agent,
				left: `${agent} · ${list.length}`,
				right: '',
				agent,
				agents: sortAgents(list, sort)
			};
		});
		return { blocked, groups };
	}

	// Workspace: first-seen order from the store, which is herdr's own order.
	const seen: string[] = [];
	const byWorkspace: Record<string, AgentSummary[]> = {};
	const labels: Record<string, AgentSummary> = {};
	for (const agent of rest) {
		const key = agent.workspaceId || 'other';
		if (!byWorkspace[key]) {
			byWorkspace[key] = [];
			labels[key] = agent;
			seen.push(key);
		}
		byWorkspace[key].push(agent);
	}
	return {
		blocked,
		groups: seen.map((key) => ({
			key,
			left: labels[key].workspaceLabel || labels[key].title || key,
			right: collapseHome(labels[key].cwd),
			agents: sortAgents(byWorkspace[key], sort)
		}))
	};
}

/**
 * What the badges at the top of the list can narrow it to.
 *
 * A status, or `dirty` — every pane whose repository has commits its upstream
 * does not, which is the question the badges could not answer before: not
 * "what is running" but "what have I left unpushed".
 */
export type ListFilter = AgentStatus | 'dirty';

/** Does this agent's directory have work its upstream has not got? */
export function isDirty(agent: AgentSummary): boolean {
	return (agent.ahead ?? 0) > 0;
}

export function matchesFilter(agent: AgentSummary, filter: ListFilter): boolean {
	return filter === 'dirty' ? isDirty(agent) : agent.status === filter;
}

/**
 * Rollup cells, each also a filter.
 *
 * `unknown` is deliberately absent — it is a state bordr could not read, not
 * one you would go looking for. `dirty` is last because it is the only cell
 * that is not a status, and it counts PANES rather than commits: the cell is
 * a filter, and what it filters to is a set of rows.
 */
export function rollupCounts(
	agents: AgentSummary[]
): Array<{ status: ListFilter; n: number; label: string }> {
	const cells: Array<{ status: ListFilter; label: string }> = [
		{ status: 'blocked', label: 'blocked' },
		{ status: 'working', label: 'working' },
		{ status: 'done', label: 'done' },
		{ status: 'idle', label: 'idle' },
		{ status: 'dirty', label: 'unpushed' }
	];
	return cells.map((cell) => ({
		...cell,
		n: agents.filter((a) => matchesFilter(a, cell.status)).length
	}));
}

/**
 * The order the conversation view swipes through — the same order the list
 * renders, flattened, so "next" on a pane means the next one you can see.
 */
export function flatOrder(
	agents: AgentSummary[],
	groupBy: GroupBy,
	sort: SortBy,
	filter: ListFilter | null = null
): string[] {
	const { blocked, groups } = partitionAgents(agents, groupBy, sort, filter);
	return [...blocked, ...groups.flatMap((g) => g.agents)].map((a) => a.paneId);
}
