import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which herdr a control reaches, with every herdr doubled.
 *
 * The defect this guards: a remote pane's summary carried its tab id bare, so
 * "close this tab" on `tm-dev~w8:p1` was parsed as a LOCAL tab and closed the
 * bordr host's own `w8:t1`.
 */
const herdr = vi.hoisted(() => ({
	requests: [] as Array<{ machine: string; method: string; params: unknown }>
}));

vi.mock('./index', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./index')>();
	return {
		...actual,
		clientFor: vi.fn(async (machine: string) => ({
			request: vi.fn(async (method: string, params: unknown) => {
				herdr.requests.push({ machine, method, params });
				if (method === 'pane.current') return { pane: { pane_id: 'w8:p9' } };
				if (method === 'pane.split') return { pane: { pane_id: 'w8:p2' } };
				return {};
			})
		}))
	};
});

vi.mock('$env/dynamic/private', () => ({ env: {} }));

beforeEach(() => {
	herdr.requests.length = 0;
});

/** What `rawAgent` hands back for a remote pane: the pane re-addressed, the rest bare. */
const REMOTE_RAW = {
	pane_id: 'tm-dev~w8:p1',
	tab_id: 'w8:t1',
	workspace_id: 'w8',
	agent: 'claude',
	agent_status: 'idle'
};

describe('controls: a remote tab', () => {
	it('carries its machine in the summary, in the pane tree format', async () => {
		const { toSummary } = await import('./index');
		const summary = toSummary(REMOTE_RAW);
		expect(summary.tabId).toBe('tm-dev~w8:t1');
		expect(summary.workspaceId).toBe('tm-dev~w8');
	});

	it('closes the tab on the machine it lives on, never on this host', async () => {
		const { toSummary } = await import('./index');
		const { close } = await import('./controls');
		await close('tab', toSummary(REMOTE_RAW).tabId);
		expect(herdr.requests).toEqual([
			{ machine: 'tm-dev', method: 'tab.close', params: { tab_id: 'w8:t1' } }
		]);
	});

	it('renames and focuses on that machine too', async () => {
		const { toSummary } = await import('./index');
		const { focus, rename } = await import('./controls');
		const summary = toSummary(REMOTE_RAW);
		await rename('tab', summary.tabId, 'deploy');
		await focus('workspace', summary.workspaceId);
		expect(herdr.requests).toEqual([
			{ machine: 'tm-dev', method: 'tab.rename', params: { tab_id: 'w8:t1', label: 'deploy' } },
			{ machine: 'tm-dev', method: 'workspace.focus', params: { workspace_id: 'w8' } }
		]);
	});

	it('leaves a local tab addressed to this host', async () => {
		const { toSummary } = await import('./index');
		const { close } = await import('./controls');
		const summary = toSummary({ ...REMOTE_RAW, pane_id: 'w8:p1' });
		expect(summary.tabId).toBe('w8:t1');
		await close('tab', summary.tabId);
		expect(herdr.requests).toEqual([
			{ machine: '', method: 'tab.close', params: { tab_id: 'w8:t1' } }
		]);
	});

	it('splits and zooms the pane on its own machine', async () => {
		const { splitPane, zoomPane } = await import('./controls');
		await expect(splitPane('tm-dev~w8:p1', 'right')).resolves.toBe('tm-dev~w8:p2');
		await expect(zoomPane('tm-dev~w8:p1')).resolves.toBe('tm-dev~w8:p1');
		expect(herdr.requests).toEqual([
			{
				machine: 'tm-dev',
				method: 'pane.split',
				params: {
					target_pane_id: 'w8:p1',
					direction: 'right',
					focus: true,
					right_click: 'herdr',
					env: {}
				}
			},
			{
				machine: 'tm-dev',
				method: 'pane.zoom',
				params: { pane_id: 'w8:p1', mode: 'toggle' }
			}
		]);
	});

	it('swaps with Herdr’s focused pane and keeps that pane focused', async () => {
		const { swapWithFocusedPane } = await import('./controls');
		await swapWithFocusedPane('tm-dev~w8:p1');
		expect(herdr.requests).toEqual([
			{ machine: 'tm-dev', method: 'pane.current', params: {} },
			{
				machine: 'tm-dev',
				method: 'pane.swap',
				params: { source_pane_id: 'w8:p9', target_pane_id: 'w8:p1' }
			},
			{ machine: 'tm-dev', method: 'pane.focus', params: { pane_id: 'w8:p9' } }
		]);
	});

	it('sets either native right-click route without guessing Herdr’s hidden current state', async () => {
		const { setPaneRightClick } = await import('./controls');
		await setPaneRightClick('tm-dev~w8:p1', 'pane');
		await setPaneRightClick('tm-dev~w8:p1', 'herdr');
		expect(herdr.requests).toEqual([
			{
				machine: 'tm-dev',
				method: 'pane.input.set',
				params: { pane_id: 'w8:p1', right_click: 'pane' }
			},
			{
				machine: 'tm-dev',
				method: 'pane.input.set',
				params: { pane_id: 'w8:p1', right_click: 'herdr' }
			}
		]);
	});
});
