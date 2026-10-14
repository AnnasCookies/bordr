import { describe, expect, it, vi } from 'vitest';
import { GLOBAL_SUBSCRIPTIONS, SubscriptionManager } from './subscriptions';
import type { HerdrClient } from './client';
import type { HerdrEvent } from './protocol';

type Sub = { type: string; pane_id?: string };

function fakeClient(handshakes: Promise<void>[] = []) {
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
				const handshake = handshakes.shift();
				if (handshake) {
					try {
						await handshake;
					} catch (error) {
						stream.closed = true;
						throw error;
					}
				}
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

describe('stream ownership', () => {
	it.each([
		[0, 1],
		[1, 0]
	])('closes superseded handshakes completing in order %s, %s', async (first, second) => {
		const handshakes: Promise<void>[] = [];
		const { client, streams } = fakeClient(handshakes);
		const manager = new SubscriptionManager(client);
		try {
			await manager.start(['w1:p1']);
			const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
			handshakes.push(...gates.map((gate) => gate.promise));
			const pending = [manager.sync(['w2:p1']), manager.sync(['w3:p1'])];
			expect(streams[0].closed).toBe(false); // make-before-break
			gates[first].resolve();
			await pending[first];
			gates[second].resolve();
			await pending[second];

			expect(streams.map((stream) => stream.closed)).toEqual([true, true, false]);
			expect(manager.tracked).toEqual(['w3:p1']);
			expect(manager.live).toBe(true);
		} finally {
			manager.stop();
		}
	});

	it('shares identical pending pane sets so noisy resyncs cannot starve a slow handshake', async () => {
		const handshakes: Promise<void>[] = [];
		const { client, streams } = fakeClient(handshakes);
		const manager = new SubscriptionManager(client);
		const first = Promise.withResolvers<void>();
		const redundant = Promise.withResolvers<void>();
		let repeated: Promise<void> | undefined;
		try {
			await manager.start(['old:p1']);
			handshakes.push(first.promise, redundant.promise);
			const pending = manager.sync(['new:p1', 'new:p2']);
			repeated = manager.sync(['new:p2', 'new:p1']);
			first.resolve();
			await pending;
			expect(manager.tracked).toEqual(['new:p1', 'new:p2']);
			expect(streams).toHaveLength(2);
			expect(streams[1].closed).toBe(false);
		} finally {
			redundant.resolve();
			await repeated;
			manager.stop();
		}
	});

	it.each([false, true])(
		'does not reuse an invalidated pending sync (restart=%s)',
		async (restart) => {
			const handshakes: Promise<void>[] = [];
			const { client, streams } = fakeClient(handshakes);
			const manager = new SubscriptionManager(client);
			const gate = Promise.withResolvers<void>();
			let stale: Promise<void> | undefined;
			let fresh: Promise<void> | undefined;
			try {
				await manager.start(['old:p1']);
				handshakes.push(gate.promise);
				stale = manager.sync(['new:p1']);
				if (restart) {
					manager.stop();
					await manager.start(['old:p1']);
				} else await manager.sync(['old:p1']);
				fresh = manager.sync(['new:p1']);
				expect(streams).toHaveLength(restart ? 4 : 3);
				await fresh;
				gate.resolve();
				await stale;
				expect(manager.tracked).toEqual(['new:p1']);
				expect(streams.at(-1)?.closed).toBe(false);
			} finally {
				gate.resolve();
				await Promise.all([stale, fresh]);
				manager.stop();
			}
		}
	);

	it('ignores a late close callback from the replaced stream', async () => {
		const { client, streams } = fakeClient();
		const manager = new SubscriptionManager(client);
		try {
			await manager.start(['w1:p1']);
			await manager.sync(['w2:p1']);
			streams[0].die();
			expect(manager.live).toBe(true);
			await manager.sync(['w2:p1']);
			expect(streams).toHaveLength(2);
		} finally {
			manager.stop();
		}
	});

	it('still notices the active stream dying during a replacement handshake', async () => {
		const handshakes: Promise<void>[] = [];
		const { client, streams } = fakeClient(handshakes);
		const manager = new SubscriptionManager(client);
		try {
			await manager.start(['w1:p1']);
			const gate = Promise.withResolvers<void>();
			handshakes.push(gate.promise);
			const pending = manager.sync(['w2:p1']);
			streams[0].die();
			expect(manager.live).toBe(false);
			gate.resolve();
			await pending;
			expect(manager.live).toBe(true);
			expect(manager.tracked).toEqual(['w2:p1']);
		} finally {
			manager.stop();
		}
	});

	it('never installs a stream that died before its handshake continuation', async () => {
		const handshakes: Promise<void>[] = [];
		const { client, streams } = fakeClient(handshakes);
		const manager = new SubscriptionManager(client);
		try {
			await manager.start(['w1:p1']);
			const gate = Promise.withResolvers<void>();
			handshakes.push(gate.promise);
			const pending = manager.sync(['w2:p1']);
			streams[1].die();
			gate.resolve();
			await pending;
			expect(streams.map((stream) => stream.closed)).toEqual([false, true]);
			expect(manager.tracked).toEqual(['w1:p1']);
			expect(manager.live).toBe(true);
		} finally {
			manager.stop();
		}
	});

	it('closes a pending replacement after stop without reviving the manager', async () => {
		const handshakes: Promise<void>[] = [];
		const { client, streams } = fakeClient(handshakes);
		const manager = new SubscriptionManager(client);
		await manager.start(['w1:p1']);
		const gate = Promise.withResolvers<void>();
		handshakes.push(gate.promise);
		const pending = manager.sync(['w2:p1']);
		manager.stop();
		gate.resolve();
		await pending;
		expect(streams.every((stream) => stream.closed)).toBe(true);
		expect(manager.live).toBe(false);
		await manager.sync(['w3:p1']);
		expect(streams).toHaveLength(2);
	});

	it('does not start a heartbeat after stop during the initial handshake', async () => {
		vi.useFakeTimers();
		const gate = Promise.withResolvers<void>();
		const { client, streams } = fakeClient([gate.promise]);
		const manager = new SubscriptionManager(client, 20);
		try {
			const pending = manager.start(['w1:p1']);
			manager.stop();
			gate.resolve();
			await pending;
			expect(manager.live).toBe(false);
			expect(streams[0].closed).toBe(true);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			manager.stop();
			vi.useRealTimers();
		}
	});

	it('cancels a pending replacement when the latest pane set matches the live stream', async () => {
		const handshakes: Promise<void>[] = [];
		const { client, streams } = fakeClient(handshakes);
		const manager = new SubscriptionManager(client);
		try {
			await manager.start(['w1:p1']);
			const gate = Promise.withResolvers<void>();
			handshakes.push(gate.promise);
			const pending = manager.sync(['w2:p1']);
			await manager.sync(['w1:p1']);
			gate.resolve();
			await pending;
			expect(streams.map((stream) => stream.closed)).toEqual([false, true]);
			expect(manager.tracked).toEqual(['w1:p1']);
		} finally {
			manager.stop();
		}
	});

	it('preserves the healthy stream on a failed replacement and retries next sync', async () => {
		const handshakes: Promise<void>[] = [];
		const { client, streams } = fakeClient(handshakes);
		const manager = new SubscriptionManager(client);
		try {
			await manager.start(['w1:p1']);
			const gate = Promise.withResolvers<void>();
			handshakes.push(gate.promise);
			const failure = expect(manager.sync(['w2:p1'])).rejects.toThrow('handshake failed');
			gate.reject(new Error('handshake failed'));
			await failure;
			expect(manager.live).toBe(true);
			expect(manager.tracked).toEqual(['w1:p1']);
			expect(streams[0].closed).toBe(false);
			await manager.sync(['w2:p1']);
			expect(streams.map((stream) => stream.closed)).toEqual([true, true, false]);
		} finally {
			manager.stop();
		}
	});

	it.each([
		[false, false],
		[true, false],
		[false, true],
		[true, true]
	])(
		'ignores a superseded heartbeat failure (restart=%s, rejection propagating=%s)',
		async (restart, propagating) => {
			vi.useFakeTimers();
			const handshakes: Promise<void>[] = [];
			const { client, streams } = fakeClient(handshakes);
			const manager = new SubscriptionManager(client, 20, async () => ['old:p1']);
			try {
				await manager.start(['initial:p1']);
				const old = Promise.withResolvers<void>();
				const latest = Promise.withResolvers<void>();
				handshakes.push(old.promise, latest.promise);
				streams[0].die();
				await vi.advanceTimersByTimeAsync(20);
				expect(streams).toHaveLength(2);
				if (propagating) {
					old.reject(new Error('obsolete handshake failed'));
					await Promise.resolve();
					await Promise.resolve();
				}
				if (restart) manager.stop();
				const pending = restart ? manager.start(['new:p1']) : manager.sync(['new:p1']);
				if (!propagating) old.reject(new Error('obsolete handshake failed'));
				await vi.advanceTimersByTimeAsync(0);
				latest.resolve();
				await pending;
				expect(streams).toHaveLength(3); // no obsolete globals-only fallback
				expect(streams[2].closed).toBe(false);
				expect(manager.tracked).toEqual(['new:p1']);
				expect(manager.live).toBe(true);
			} finally {
				manager.stop();
				vi.useRealTimers();
			}
		}
	);

	it('ignores a heartbeat snapshot superseded while its pane lookup was pending', async () => {
		vi.useFakeTimers();
		const panes = Promise.withResolvers<string[]>();
		const { client, streams } = fakeClient();
		const manager = new SubscriptionManager(client, 20, () => panes.promise);
		try {
			await manager.start(['old:p1']);
			await vi.advanceTimersByTimeAsync(20);
			await manager.sync(['new:p1']);
			panes.resolve(['old:p1']);
			await vi.advanceTimersByTimeAsync(0);
			expect(streams).toHaveLength(2);
			expect(manager.tracked).toEqual(['new:p1']);
		} finally {
			manager.stop();
			vi.useRealTimers();
		}
	});

	it('does not revive after stop while the heartbeat is listing panes', async () => {
		vi.useFakeTimers();
		const panes = Promise.withResolvers<string[]>();
		const { client, streams } = fakeClient();
		const manager = new SubscriptionManager(client, 20, () => panes.promise);
		try {
			await manager.start(['w1:p1']);
			streams[0].die();
			await vi.advanceTimersByTimeAsync(20);
			manager.stop();
			panes.resolve(['w2:p1']);
			await vi.advanceTimersByTimeAsync(0);
			expect(manager.live).toBe(false);
			expect(streams).toHaveLength(1);
		} finally {
			manager.stop();
			vi.useRealTimers();
		}
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
