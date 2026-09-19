import { describe, expect, it, vi } from 'vitest';
import { waitForWorkspacePane } from './workspace-pane';

describe('waitForWorkspacePane', () => {
	it('returns the pane belonging to the new workspace', async () => {
		await expect(
			waitForWorkspacePane('w2', async () => ({
				snapshot: {
					panes: [
						{ pane_id: 'w1:p1', workspace_id: 'w1' },
						{ pane_id: 'w2:p1', workspace_id: 'w2' }
					]
				}
			}))
		).resolves.toBe('w2:p1');
	});

	it('waits through snapshots published before the pane', async () => {
		const snapshots = [
			{ snapshot: { panes: [{ pane_id: 'w1:p1', workspace_id: 'w1' }] } },
			{ snapshot: { panes: [{ pane_id: 'w2:p1', workspace_id: 'w2' }] } }
		];
		const read = vi.fn(async () => snapshots.shift() ?? snapshots.at(-1) ?? {});
		const pause = vi.fn(async () => undefined);
		await expect(waitForWorkspacePane('w2', read, { attempts: 3, pause })).resolves.toBe('w2:p1');
		expect(read).toHaveBeenCalledTimes(2);
		expect(pause).toHaveBeenCalledTimes(1);
	});

	it('returns null after its bounded attempts', async () => {
		const read = vi.fn(async () => ({ snapshot: { panes: [] } }));
		await expect(
			waitForWorkspacePane('w2', read, { attempts: 3, pause: async () => undefined })
		).resolves.toBeNull();
		expect(read).toHaveBeenCalledTimes(3);
	});
});
