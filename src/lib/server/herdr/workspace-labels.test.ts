import { expect, it, vi } from 'vitest';
import type { HerdrClient } from './client';
import { tabLabels, toSummary, workspaceLabels } from './index';

it('reads names from the supplied instance even when local and remote bare ids collide', async () => {
	for (const machine of ['', 'remote']) {
		const client = {
			request: vi.fn(async (method: string) =>
				method === 'workspace.list'
					? { workspaces: [{ workspace_id: 'w8', label: `${machine || 'local'} workspace` }] }
					: { tabs: [{ tab_id: 'w8:t1', label: `${machine || 'local'} tab` }] }
			)
		};
		const summary = toSummary(
			{
				pane_id: `${machine ? `${machine}~` : ''}w8:p1`,
				workspace_id: 'w8',
				tab_id: 'w8:t1',
				agent: 'claude',
				name: 'claude',
				agent_status: 'idle'
			},
			await workspaceLabels(client as unknown as HerdrClient),
			await tabLabels(client as unknown as HerdrClient)
		);
		expect(summary.workspaceLabel).toBe(`${machine || 'local'} workspace`);
		expect(summary.tabLabel).toBe(`${machine || 'local'} tab`);
		expect(summary.workspaceId).toBe(`${machine ? `${machine}~` : ''}w8`);
	}
});

it('treats a harness name as literal text rather than a regular expression', () => {
	expect(
		toSummary(
			{ pane_id: 'w8:p1', workspace_id: 'w8', agent: 'custom+', name: 'custom+-w8-p1' },
			new Map([['w8', 'workspace']])
		).title
	).toBe('workspace');
});
