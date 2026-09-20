import type { WorkspaceNode } from '$lib/types';

/** Pick a surviving pane after the pane in the current URL has exited. */
export function paneAfterExit(
	workspaces: readonly WorkspaceNode[],
	current: string,
	tabId = ''
): string | null {
	const tabs = workspaces.flatMap((workspace) => workspace.tabs);
	const sameTab = tabs.find((tab) => tab.tabId === tabId)?.panes ?? [];
	const all = tabs.flatMap((tab) => tab.panes);
	return (
		sameTab.find((pane) => pane.paneId !== current)?.paneId ??
		all.find((pane) => pane.paneId !== current)?.paneId ??
		null
	);
}
