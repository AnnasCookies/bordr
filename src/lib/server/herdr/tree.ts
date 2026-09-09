import { getClient } from './index';
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
export async function paneTree(): Promise<WorkspaceNode[]> {
	const herdr = getClient();
	const [workspaces, tabs, panes] = await Promise.all([
		herdr.request<{ workspaces: Record<string, unknown>[] }>('workspace.list'),
		herdr.request<{ tabs: Record<string, unknown>[] }>('tab.list'),
		herdr.request<{ panes: Record<string, unknown>[] }>('pane.list')
	]);

	const byTab = new Map<string, PaneNode[]>();
	for (const raw of panes.panes) {
		const agent = String(raw.agent ?? '');
		const node: PaneNode = {
			paneId: String(raw.pane_id ?? ''),
			tabId: String(raw.tab_id ?? ''),
			workspaceId: String(raw.workspace_id ?? ''),
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
		const tabId = String(raw.tab_id ?? '');
		const node: TabNode = {
			tabId,
			workspaceId: String(raw.workspace_id ?? ''),
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
		const workspaceId = String(raw.workspace_id ?? '');
		return {
			workspaceId,
			label: String(raw.label ?? ''),
			number: Number(raw.number ?? 0),
			focused: raw.focused === true,
			tabs: (byWorkspace.get(workspaceId) ?? []).sort((a, b) => a.number - b.number)
		} satisfies WorkspaceNode;
	});
}
