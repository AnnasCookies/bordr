import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
	request: vi.fn(async (method: string) =>
		method === 'workspace.create' ? { workspace: { workspace_id: 'w1' } } : {}
	)
}));
vi.mock('#lib/server/herdr/index.js', () => ({
	getClient: () => ({ request: fixture.request }),
	HerdrRequestError: class extends Error {},
	sendText: vi.fn(),
	rawAgent: vi.fn(),
	readVisible: async () => '',
	sendKeys: vi.fn(),
	settleScreen: async () => {},
	waitForActiveAgent: async () => true
}));
vi.mock('#lib/server/herdr/workspace-pane.js', () => ({
	waitForWorkspacePane: async () => 'w1:p1'
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it.each([
	[undefined, null],
	['', null],
	['   ', null],
	['My project', 'My project'],
	['  My project  ', 'My project']
])(
	'lets herdr choose the workspace name unless a label is supplied: %s',
	async (label, expected) => {
		const { POST } = await import('./+server');
		const pending = POST({
			request: new Request('http://fixture/api/agents/new', {
				method: 'POST',
				body: JSON.stringify({ kind: 'claude', label })
			})
		} as never);
		await vi.advanceTimersByTimeAsync(1500);
		const response = await pending;
		expect(await response.json()).toEqual({ ok: true, paneId: 'w1:p1' });
		expect(fixture.request).toHaveBeenCalledWith('workspace.create', {
			cwd: null,
			label: expected,
			focus: false
		});
		// Naming a workspace is independent of the strict agent.start machine name.
		expect(fixture.request).toHaveBeenCalledWith(
			'agent.start',
			expect.objectContaining({ name: expected ? 'my-project' : 'claude' })
		);
	}
);
