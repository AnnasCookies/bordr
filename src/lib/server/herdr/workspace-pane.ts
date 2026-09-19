export interface WorkspacePaneSnapshot {
	snapshot?: { panes?: Array<{ pane_id?: string; workspace_id?: string }> };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A created workspace and its first pane are published separately by Herdr.
 * Poll the authoritative snapshot instead of treating one delayed read as a
 * guarantee that the pane already exists.
 */
export async function waitForWorkspacePane(
	workspaceId: string,
	read: () => Promise<WorkspacePaneSnapshot>,
	options: {
		attempts?: number;
		intervalMs?: number;
		pause?: (ms: number) => Promise<unknown>;
	} = {}
): Promise<string | null> {
	const attempts = Math.max(1, options.attempts ?? 40);
	const intervalMs = Math.max(0, options.intervalMs ?? 250);
	const pause = options.pause ?? sleep;
	for (let attempt = 0; attempt < attempts; attempt++) {
		const snapshot = await read();
		const pane = snapshot.snapshot?.panes?.find((item) => item.workspace_id === workspaceId);
		if (pane?.pane_id) return pane.pane_id;
		if (attempt + 1 < attempts) await pause(intervalMs);
	}
	return null;
}
