import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSummary } from '$lib/types';
import type { Compatibility } from './herdr/compat';

/**
 * The projector is a module singleton over herdr's client functions; these
 * doubles stand in for herdr so the tests can make it slow, dead, or back.
 */
const herdr = vi.hoisted(() => ({
	listAgents: vi.fn<() => Promise<AgentSummary[]>>(),
	checkCompatibility: vi.fn<() => Promise<Compatibility>>(),
	getManager: vi.fn<() => Promise<{ onEvent: (fn: () => void) => () => void }>>(),
	unreachableCompatibility: (cause: unknown): Compatibility => ({
		level: 'unreachable',
		version: null,
		protocol: null,
		message: `herdr is not reachable: ${(cause as Error).message}`
	})
}));
vi.mock('./herdr', () => herdr);
vi.mock('./enrich', () => ({ enrichAgents: async (agents: AgentSummary[]) => agents }));
vi.mock('./state-store', () => ({ readState: () => ({}) }));
// The projector reports every enriched status to the push watcher; doubled
// here so these tests need no VAPID keys or subscription store.
vi.mock('./push', () => ({ observeStatus: vi.fn() }));

const OK: Compatibility = { level: 'ok', version: '1', protocol: 20, message: null };
const agent = (paneId: string): AgentSummary => ({
	paneId,
	agent: 'claude',
	title: '',
	status: 'idle',
	cwd: '/',
	seq: 1,
	workspaceId: '1',
	workspaceLabel: '',
	tabId: 't1',
	tabLabel: ''
});

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	vi.resetModules();
	herdr.listAgents.mockReset();
	herdr.checkCompatibility.mockReset().mockResolvedValue(OK);
	herdr.getManager.mockReset().mockResolvedValue({ onEvent: () => () => {} });
});

afterEach(() => {
	vi.useRealTimers();
});

/** A fresh singleton per test — the module keeps state across imports. */
async function load() {
	return (await import('./projector')).projector;
}

describe('projector refresh', () => {
	it('runs once more when an event lands mid-refresh, instead of dropping it', async () => {
		let release: (() => void) | undefined;
		herdr.listAgents
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = () => resolve([agent('a')]);
					})
			)
			.mockResolvedValue([agent('a'), agent('b')]);

		const projector = await load();
		const seen: string[][] = [];
		const first = projector.subscribe((p) => seen.push(p.agents.map((a) => a.paneId)));
		await flush();
		// Two pokes while the first read is still in flight: they coalesce
		// into exactly one further pass, not zero and not two.
		projector.poke();
		projector.poke();
		release?.();
		await first;
		await flush();
		// Not yet: the follow-up waits out the quiet window rather than
		// running back to back, so a streaming pane cannot make the passes
		// continuous.
		expect(herdr.listAgents).toHaveBeenCalledTimes(1);
		await new Promise((r) => setTimeout(r, 200));

		expect(herdr.listAgents).toHaveBeenCalledTimes(2);
		expect(seen.at(-1)).toEqual(['a', 'b']);
	});

	it('re-reads on a timer while it has subscribers, and stops when the last one leaves', async () => {
		vi.useFakeTimers();
		herdr.listAgents.mockResolvedValue([agent('a')]);

		const projector = await load();
		const fn = () => {};
		await projector.subscribe(fn);
		const after = herdr.listAgents.mock.calls.length;

		// herdr sends nothing for a dialog drawn in place on an idle pane, so
		// a watched projection is re-read on a beat of its own.
		await vi.advanceTimersByTimeAsync(3_100);
		expect(herdr.listAgents).toHaveBeenCalledTimes(after + 1);
		await vi.advanceTimersByTimeAsync(3_000);
		expect(herdr.listAgents).toHaveBeenCalledTimes(after + 2);

		projector.unsubscribe(fn);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(herdr.listAgents).toHaveBeenCalledTimes(after + 2);
	});

	it('does not fan out a projection identical to the last one', async () => {
		herdr.listAgents.mockResolvedValue([agent('a')]);

		const projector = await load();
		let notified = 0;
		await projector.subscribe(() => notified++);
		const before = notified;

		// Three pokes, nothing changed underneath: the phones hear nothing.
		// The revision is assigned inside publish(), so a comparison that
		// included it could never match; this guards that regression.
		projector.poke();
		await flush();
		projector.poke();
		await flush();
		projector.poke();
		await flush();

		expect(herdr.listAgents.mock.calls.length).toBeGreaterThanOrEqual(3);
		expect(notified).toBe(before);
	});

	it('publishes an unreachable compat when herdr dies after boot', async () => {
		herdr.listAgents
			.mockResolvedValueOnce([agent('a')])
			.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

		const projector = await load();
		const seen: Array<[Compatibility['level'], string[]]> = [];
		const initial = await projector.subscribe((p) =>
			seen.push([p.compat.level, p.agents.map((a) => a.paneId)])
		);
		expect(initial.compat.level).toBe('ok');

		projector.poke();
		await flush();

		// The agents are kept (the phone still lists them) but the banner flips.
		expect(seen.at(-1)).toEqual(['unreachable', ['a']]);
	});

	it('retries the wiring while herdr is down and feeds the waiting subscriber', async () => {
		vi.useFakeTimers();
		herdr.getManager
			.mockRejectedValueOnce(new Error('connect ENOENT'))
			.mockResolvedValue({ onEvent: () => () => {} });
		herdr.listAgents.mockResolvedValue([agent('a')]);

		const projector = await load();
		const received: string[][] = [];
		await expect(
			projector.subscribe((p) => received.push(p.agents.map((a) => a.paneId)))
		).rejects.toThrow('ENOENT');

		await vi.advanceTimersByTimeAsync(15_000);
		expect(herdr.getManager).toHaveBeenCalledTimes(2);
		expect(received).toEqual([['a']]);

		// Wired now: the timer must stop rather than keep knocking.
		await vi.advanceTimersByTimeAsync(60_000);
		expect(herdr.getManager).toHaveBeenCalledTimes(2);
	});
});
