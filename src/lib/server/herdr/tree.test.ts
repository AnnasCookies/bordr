import { expect, it, vi } from 'vitest';
import type { Machine } from './machines';
const fixture = vi.hoisted(() => ({
	machines: [] as Machine[],
	delay: null as Promise<void> | null
}));
vi.mock('./machines', () => ({ listMachines: () => fixture.machines }));
vi.mock('./index', () => ({
	getClient: () => ({ request: async () => ({ workspaces: [], tabs: [], panes: [] }) })
}));
vi.mock('./layout', () => ({ layoutsFor: async () => new Map() }));
vi.mock('./branches', () => ({ branchesFor: async () => new Map() }));
vi.mock('./connections', async (original) => ({
	...(await original<typeof import('./connections')>()),
	activeConnections: async () =>
		fixture.machines.map((machine) => {
			const delay = fixture.delay;
			return {
				machine,
				client: {
					request: async () => {
						await delay;
						return {
							workspaces: [{ workspace_id: 'w', label: machine.target }],
							tabs: [],
							panes: []
						};
					}
				}
			};
		})
}));
import { paneTree } from './tree';
it('never serves a cached or in-flight old identity after retarget, session change, disable or removal', async () => {
	fixture.machines = [
		{ id: 'remote', label: 'Fixture', target: 'old', session: 'default', enabled: true }
	];
	await paneTree();
	await expect.poll(async () => (await paneTree())[0]?.label).toBe('old');
	for (const change of [{ target: 'new' }, { session: 'second', target: 'session-new' }]) {
		fixture.machines = [{ ...fixture.machines[0], ...change }];
		expect(await paneTree()).toEqual([]);
		await expect.poll(async () => (await paneTree())[0]?.label).toBe(change.target);
	}
	fixture.machines = [{ ...fixture.machines[0], enabled: false }];
	expect(await paneTree()).toEqual([]);
	let release!: () => void;
	fixture.delay = new Promise((r) => {
		release = r;
	});
	fixture.machines = [{ ...fixture.machines[0], enabled: true, target: 'in-flight' }];
	await paneTree();
	fixture.machines = [];
	release();
	await new Promise((r) => setTimeout(r, 0));
	expect(await paneTree()).toEqual([]);
	// Re-adding this identity must fetch, not publish the revoked in-flight result.
	fixture.machines = [
		{ id: 'remote', label: 'Fixture', target: 'in-flight', session: 'second', enabled: true }
	];
	fixture.delay = new Promise(() => {});
	expect(await paneTree()).toEqual([]);
});
