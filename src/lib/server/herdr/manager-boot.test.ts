import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SubscriptionManager } from './subscriptions';

const fixture = vi.hoisted(() => ({
	failure: '',
	closes: [] as Array<ReturnType<typeof vi.fn>>,
	request: vi.fn(),
	subscribe: vi.fn()
}));
vi.mock('$env/dynamic/private', () => ({ env: { HERDR_SOCKET: '/fixture/herdr.sock' } }));
vi.mock('./machines', () => ({ listMachines: () => [] }));
vi.mock('./client', () => ({
	HerdrClient: class {
		request = fixture.request;
		subscribe = fixture.subscribe;
	},
	HerdrRequestError: class extends Error {}
}));

let manager: SubscriptionManager | undefined;
beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	manager = undefined;
	fixture.closes = [];
	fixture.request.mockReset().mockImplementation(async (method: string) => {
		if (method === 'agent.list') {
			if (fixture.failure === 'list') {
				fixture.failure = '';
				throw new Error('list failed');
			}
			return { agents: [{ pane_id: 'w1:p1' }] };
		}
		return method === 'workspace.list' ? { workspaces: [] } : { tabs: [] };
	});
	fixture.subscribe.mockReset().mockImplementation(async (subs: Array<{ pane_id?: string }>) => {
		if (
			fixture.failure === 'initial' ||
			(fixture.failure === 'scoped' && subs.some((sub) => sub.pane_id))
		) {
			const failure = fixture.failure;
			fixture.failure = '';
			throw new Error(`${failure} failed`);
		}
		const close = vi.fn();
		fixture.closes.push(close);
		return close;
	});
});
afterEach(() => {
	manager?.stop();
	vi.useRealTimers();
});

it.each(['initial', 'list', 'scoped'])(
	'cleans up failed %s boot before allowing a retry',
	async (failure) => {
		fixture.failure = failure;
		const { getManager } = await import('./index');
		await expect(getManager()).rejects.toThrow(`${failure} failed`);
		expect(fixture.closes.every((close) => close.mock.calls.length === 1)).toBe(true);
		expect(vi.getTimerCount()).toBe(0);

		manager = await getManager();
		expect(await getManager()).toBe(manager);
		expect(manager.live).toBe(true);
		expect(manager.tracked).toEqual(['w1:p1']);
		expect(fixture.closes.at(-1)).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(1);
		manager.stop();
		expect(fixture.closes.every((close) => close.mock.calls.length === 1)).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		manager = undefined;
	}
);
