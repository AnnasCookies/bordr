import { getClient } from './index';
import type { HerdrClient } from './client';
import { activeConnections } from './connections';
import { formatPane } from './address';
import type { PaneNode, TabNode, WorkspaceNode } from '$lib/types';

/**
 * The whole session as herdr sees it: workspaces, their tabs, their panes.
 *
 * `agent.list` returns only panes herdr has DETECTED an agent in, which is
 * why a pane running a shell, a log tail or a build was invisible in bordr
 * while sitting in the same tab in the terminal (measured: 21 panes, 14 of
 * them agents). `pane.list` returns every pane and already carries the agent
 * fields where there is one, so a single call answers both questions.
 */
/**
 * Per-machine trees, last known good.
 *
 * A machine's tree is served from here and refreshed in the BACKGROUND. The
 * request never waits on ssh: a machine that is down took an 8s connect
 * timeout with it, on a tree that polls every five seconds, which made the
 * whole sidebar crawl whenever anything was unreachable.
 */
const cached = new Map<string, { at: number; workspaces: WorkspaceNode[] }>();
const refreshing = new Set<string>();
/** How stale a machine's tree may get before a refresh is kicked off. */
const REFRESH_MS = 4000;

function refreshMachines(): void {
	void (async () => {
		let connections: Awaited<ReturnType<typeof activeConnections>>;
		try {
			connections = await activeConnections();
		} catch {
			return;
		}
		const live = new Set(connections.map((c) => c.machine.id));
		// Forget a machine that has gone away, so its panes stop being listed.
		for (const id of [...cached.keys()]) if (!live.has(id)) cached.delete(id);

		await Promise.all(
			connections.map(async (c) => {
				const entry = cached.get(c.machine.id);
				if (entry && Date.now() - entry.at < REFRESH_MS) return;
				if (refreshing.has(c.machine.id)) return;
				refreshing.add(c.machine.id);
				try {
					const workspaces = await treeFor(c.client, c.machine.id, c.machine.label);
					cached.set(c.machine.id, { at: Date.now(), workspaces });
				} catch (e) {
					// Named, not swallowed: a machine that answers the forward
					// but not the protocol is a different problem from one that
					// is off. Its last good tree stands until it is gone.
					console.error(`bordr: machine ${c.machine.label} tree failed —`, String(e));
				} finally {
					refreshing.delete(c.machine.id);
				}
			})
		);
	})();
}

export async function paneTree(): Promise<WorkspaceNode[]> {
	// This host is always read live: it is local, it is fast, and it is the
	// one that has to be right.
	const local = await treeFor(getClient(), '', '');
	refreshMachines();
	const remote = [...cached.values()].flatMap((entry) => entry.workspaces);
	return [...local, ...remote];
}

async function treeFor(
	herdr: HerdrClient,
	machineId: string,
	machineLabel: string
): Promise<WorkspaceNode[]> {
	const [workspaces, tabs, panes] = await Promise.all([
		herdr.request<{ workspaces: Record<string, unknown>[] }>('workspace.list'),
		herdr.request<{ tabs: Record<string, unknown>[] }>('tab.list'),
		herdr.request<{ panes: Record<string, unknown>[] }>('pane.list')
	]);

	const byTab = new Map<string, PaneNode[]>();
	for (const raw of panes.panes) {
		const agent = String(raw.agent ?? '');
		const node: PaneNode = {
			// Addressed for bordr, not for herdr: a remote pane carries its
			// machine so every route can find its way back to the right server.
			paneId: formatPane(machineId, String(raw.pane_id ?? '')),
			tabId: formatPane(machineId, String(raw.tab_id ?? '')),
			workspaceId: formatPane(machineId, String(raw.workspace_id ?? '')),
			// A pane with no agent is a shell: it has a screen and takes keys,
			// but there is no transcript, status or picker to be had.
			agent,
			hasAgent: agent !== '',
			status: agent ? String(raw.agent_status ?? 'unknown') : 'shell',
			title: String(raw.terminal_title_stripped ?? raw.terminal_title ?? ''),
			cwd: String(raw.cwd ?? ''),
			focused: raw.focused === true
		};
		const list = byTab.get(node.tabId);
		if (list) list.push(node);
		else byTab.set(node.tabId, [node]);
	}

	const byWorkspace = new Map<string, TabNode[]>();
	for (const raw of tabs.tabs) {
		const tabId = formatPane(machineId, String(raw.tab_id ?? ''));
		const node: TabNode = {
			tabId,
			workspaceId: formatPane(machineId, String(raw.workspace_id ?? '')),
			label: String(raw.label ?? ''),
			number: Number(raw.number ?? 0),
			focused: raw.focused === true,
			panes: byTab.get(tabId) ?? []
		};
		const list = byWorkspace.get(node.workspaceId);
		if (list) list.push(node);
		else byWorkspace.set(node.workspaceId, [node]);
	}

	return workspaces.workspaces.map((raw) => {
		const workspaceId = formatPane(machineId, String(raw.workspace_id ?? ''));
		return {
			workspaceId,
			machine: machineLabel,
			label: String(raw.label ?? ''),
			number: Number(raw.number ?? 0),
			focused: raw.focused === true,
			tabs: (byWorkspace.get(workspaceId) ?? []).sort((a, b) => a.number - b.number)
		} satisfies WorkspaceNode;
	});
}
