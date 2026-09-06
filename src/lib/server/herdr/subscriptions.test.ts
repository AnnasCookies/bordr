import { describe, expect, it, vi } from 'vitest';
import { GLOBAL_SUBSCRIPTIONS, SubscriptionManager } from './subscriptions';
import type { HerdrClient } from './client';
import type { HerdrEvent } from './protocol';

type Sub = { type: string; pane_id?: string };

function fakeClient() {
	const streams: Array<{
		subs: Sub[];
		emit: (e: HerdrEvent) => void;
		die: () => void;
		closed: boolean;
	}> = [];
	const client = {
		subscribe: vi.fn(
			async (subs: Sub[], onEvent: (e: HerdrEvent) => void, onClose?: () => void) => {
				const stream = {
					subs,
					emit: onEvent,
					die: () => onClose?.(),
					closed: false
				};
				streams.push(stream);
				return () => {
					stream.closed = true;
				};
			}
		)
	} as unknown as HerdrClient;
	return { client, streams };
}

describe('SubscriptionManager', () => {
	it('opens one stream carrying globals plus one status subscription per pane', async () => {
		const { client, streams } = fakeClient();
		const manager = new SubscriptionManager(client);
		await manager.start(['w1:p1', 'w2:p1']);

		expect(streams).toHaveLength(1);
		for (const type of GLOBAL_SUBSCRIPTIONS) {
			expect(streams[0].subs).toContainEqual({ type });
		}
		expect(streams[0].subs).toContainEqual({ type: 'pane.agent_status_changed', pane_id: 'w1:p1' });
		expect(streams[0].subs).toContainEqual({ type: 'pane.agent_status_changed', pane_id: 'w2:p1' });
		expect(manager.tracked).toEqual(['w1:p1', 'w2:p1']);
	});

	it('leaves the stream alone when the pane set is unchanged', async () => {
		const { client, streams } = fakeClient();
		const manager = new SubscriptionManager(client);
		await manager.start(['w1:p1']);
		await manager.sync(['w1:p1']);
		expect(streams).toHaveLength(1);
	});

	it('reopens with the full set when a pane appears, then closes the old stream', async () => {
		const { client, streams } = fakeClient();
		const manager = new SubscriptionManager(client);
		await manager.start(['w1:p1']);
		await manager.sync(['w1:p1', 'w2:p1']);

		expect(streams).toHaveLength(2);
		expect(streams[0].closed).toBe(true);
		expect(streams[1].closed).toBe(false);
		expect(streams[1].subs).toContainEqual({ type: 'pane.agent_status_changed', pane_id: 'w2:p1' });
		expect(manager.tracked).toEqual(['w1:p1', 'w2:p1']);
	});

	it('fans events out to listeners', async () => {
		const { client, streams } = fakeClient();
		const manager = new SubscriptionManager(client);
		await manager.start([]);
		const seen: string[] = [];
		manager.onEvent((e) => seen.push(e.event));
		streams[0].emit({ event: 'pane.updated', data: { type: 'pane_updated' } });
		expect(seen).toEqual(['pane.updated']);
	});

	it('reopens on the next sync after the stream dies', async () => {
		const { client, streams } = fakeClient();
		const manager = new SubscriptionManager(client);
		await manager.start(['w1:p1']);
		streams[0].die();
		expect(manager.live).toBe(false);
		await manager.sync(['w1:p1']);
		expect(streams).toHaveLength(2);
		expect(manager.live).toBe(true);
	});
});

describe('stream liveness', () => {
	it('revives a dead stream on its own, with no events and no clients', async () => {
		const { client, streams } = fakeClient();
		const manager = new SubscriptionManager(client, 20);
		await manager.start(['w1:p1']);

		streams[0].die(); // herdr restarted; nobody is watching
		expect(manager.live).toBe(false);

		await new Promise((r) => setTimeout(r, 80));

		expect(manager.live).toBe(true);
		expect(streams.length).toBeGreaterThan(1);
		expect(streams.at(-1)!.subs).toContainEqual({
			type: 'pane.agent_status_changed',
			pane_id: 'w1:p1'
		});
		manager.stop();
	});

	it('does not reopen while the stream is healthy', async () => {
		const { client, streams } = fakeClient();
		const manager = new SubscriptionManager(client, 20);
		await manager.start(['w1:p1']);
		await new Promise((r) => setTimeout(r, 80));
		expect(streams).toHaveLength(1);
		manager.stop();
	});
});
