import type { WorkspaceNode } from '$lib/types';

/**
 * The part of /api/panes that can change the conversation's split geometry.
 *
 * Status, titles and cwd move constantly and are rendered elsewhere. Letting
 * those fields replace the split tree every five seconds remounted every
 * terminal preview, blanking it for a frame before the same screen returned.
 */
export function splitLayoutFingerprint(workspaces: WorkspaceNode[]): string {
	return JSON.stringify(
		workspaces.map((workspace) =>
			workspace.tabs.map((tab) => ({
				tabId: tab.tabId,
				panes: tab.panes.map((pane) => pane.paneId),
				tree: tab.layout?.tree ?? null
			}))
		)
	);
}
