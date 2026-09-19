import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SplitNode } from './types';
import {
	projectActivePaneGeometry,
	quantiseViewport,
	tabViewport,
	type TabViewportOptions
} from './tab-viewport';

const phone = { cols: 45, rows: 30, cellWidthPx: 8, cellHeightPx: 16 };

function pane(paneId: string): SplitNode {
	return { kind: 'pane', paneId };
}

function split(
	vertical: boolean,
	ratio: number,
	first: SplitNode,
	second: SplitNode,
	path: boolean[] = []
): SplitNode {
	return { kind: 'split', vertical, ratio, first, second, path };
}

describe('quantiseViewport', () => {
	it('uses whole terminal cells', () => {
		expect(quantiseViewport(1000, 500, 8, 16)).toEqual({
			cols: 125,
			rows: 31,
			cellWidthPx: 8,
			cellHeightPx: 16
		});
	});

	it('clamps dimensions to the Herdr contract', () => {
		expect(quantiseViewport(1, 1, 8, 16)).toEqual({
			cols: 10,
			rows: 3,
			cellWidthPx: 8,
			cellHeightPx: 16
		});
		expect(quantiseViewport(100_000, 100_000, 8, 16)?.cols).toBe(1000);
		expect(quantiseViewport(100_000, 100_000, 8, 16)?.rows).toBe(500);
	});

	it('refuses unmeasurable boxes', () => {
		expect(quantiseViewport(0, 500, 8, 16)).toBeNull();
		expect(quantiseViewport(1000, 500, 0, 16)).toBeNull();
	});
});

describe('projectActivePaneGeometry', () => {
	it('leaves a single pane at the phone grid', () => {
		expect(projectActivePaneGeometry(phone, pane('active'), 'active')).toEqual(phone);
	});

	it('expands a side split so the selected pane keeps the phone columns', () => {
		const tree = split(false, 0.5, pane('other'), pane('active'));
		expect(projectActivePaneGeometry(phone, tree, 'active')).toEqual({
			...phone,
			cols: 94,
			rows: 32
		});
	});

	it('inverts each split on the path to a nested selected pane', () => {
		const tree = split(
			false,
			0.4,
			pane('left'),
			split(true, 0.5, pane('top'), pane('active'), [true]),
			[]
		);
		expect(projectActivePaneGeometry(phone, tree, 'active')).toEqual({
			...phone,
			cols: 78,
			rows: 64
		});
	});

	it('does not project an inconsistent tree', () => {
		const tree = split(false, 0.5, pane('one'), pane('two'));
		expect(projectActivePaneGeometry(phone, tree, 'missing')).toEqual(phone);
	});
});

/**
 * The action against a doubled DOM and a doubled /api/geometry. Node has no
 * layout, so the box is fixed: what is under test is the lease's timing.
 */
interface Write {
	action: 'claim' | 'update' | 'release';
	tabId: string;
	leaseId?: string;
}

const box = {
	querySelector: () => null,
	querySelectorAll: () => [],
	clientWidth: 800,
	clientHeight: 400
} as unknown as HTMLElement;

let writes: Write[];
let leases: number;
let mounted: Array<{ destroy(): void }>;
let respond: (write: Write) => Response | Promise<Response>;
let doc: EventTarget & { visibilityState: string };

function reply(status: number, body: unknown = {}): Response {
	return new Response(JSON.stringify(body), { status });
}

/** Herdr granting every claim and renewing every lease. */
function grantAll(write: Write): Response {
	return write.action === 'claim'
		? reply(200, { lease_id: `lease-${++leases}` })
		: reply(200, { lease_id: write.leaseId });
}

function writesOf(action: Write['action']): Write[] {
	return writes.filter((write) => write.action === action);
}

function setVisibility(state: 'hidden' | 'visible') {
	doc.visibilityState = state;
	doc.dispatchEvent(new Event('visibilitychange'));
}

function mount(overrides: Partial<TabViewportOptions> = {}) {
	const activity: boolean[] = [];
	const options: TabViewportOptions = {
		tabId: 'w1:t1',
		mono: 12,
		density: 'comfortable',
		onactive: (active) => activity.push(active),
		...overrides
	};
	const action = tabViewport(box, options);
	mounted.push(action);
	return { action, options, activity };
}

describe('tabViewport lease', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		writes = [];
		leases = 0;
		mounted = [];
		respond = grantAll;
		doc = Object.assign(new EventTarget(), {
			visibilityState: 'visible',
			documentElement: { clientWidth: 1000 },
			createElement: () => ({ getContext: () => null })
		});
		vi.stubGlobal('document', doc);
		vi.stubGlobal('window', new EventTarget());
		vi.stubGlobal('getComputedStyle', () => ({ fontFamily: 'monospace' }));
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				disconnect() {}
			}
		);
		vi.stubGlobal(
			'MutationObserver',
			class {
				observe() {}
				disconnect() {}
			}
		);
		vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
		vi.stubGlobal('cancelAnimationFrame', (frame: number) => clearTimeout(frame));
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: RequestInit) => {
				const write = JSON.parse(String(init.body)) as Write;
				writes.push(write);
				return respond(write);
			})
		);
	});

	afterEach(() => {
		for (const action of mounted) action.destroy();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('keeps one claim retry pending however often the view updates', async () => {
		respond = (write) =>
			write.action === 'claim'
				? reply(409, { message: 'viewport_busy: held by bordr:other' })
				: grantAll(write);
		const { action, options } = mount();
		await vi.advanceTimersByTimeAsync(16);
		expect(writesOf('claim')).toHaveLength(1);
		// Agent detail re-renders the page every two seconds while it works.
		for (let beat = 0; beat < 20; beat++) {
			action.update({ ...options });
			await vi.advanceTimersByTimeAsync(2_000);
		}
		// One retry per conflict window (at 16 s and 32 s), not one per update.
		expect(writesOf('claim')).toHaveLength(3);
	});

	it.each([
		['an expired lease', 409, 'viewport_expired: lease lapsed'],
		['a lease Herdr no longer knows', 400, 'invalid_request: no such lease']
	])('drops %s and claims afresh', async (_name, status, message) => {
		respond = (write) =>
			write.action === 'update' && write.leaseId === 'lease-1'
				? reply(status, { message })
				: grantAll(write);
		const { activity } = mount();
		await vi.advanceTimersByTimeAsync(16);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(writes.map((write) => [write.action, write.leaseId ?? ''])).toEqual([
			['claim', ''],
			['update', 'lease-1'],
			['claim', ''],
			['update', 'lease-2']
		]);
		expect(activity).toEqual([true, false, true]);
	});

	it('drops a lease whose renewals have failed for longer than its TTL', async () => {
		respond = (write) =>
			write.action === 'update' ? Promise.reject(new TypeError('network down')) : grantAll(write);
		const { activity } = mount();
		await vi.advanceTimersByTimeAsync(16);
		await vi.advanceTimersByTimeAsync(10_000);
		// Two lost beats inside the TTL keep the token.
		expect(activity).toEqual([true]);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(activity).toEqual([true, false, true]);
		expect(writes.map((write) => [write.action, write.leaseId ?? ''])).toEqual([
			['claim', ''],
			['update', 'lease-1'],
			['update', 'lease-1'],
			['update', 'lease-1'],
			['claim', '']
		]);
	});

	it('leaves a lease the terminal took back until the page is shown again', async () => {
		respond = (write) =>
			write.action === 'update'
				? reply(409, { message: 'viewport_not_owned: native input' })
				: grantAll(write);
		const { action, options, activity } = mount();
		await vi.advanceTimersByTimeAsync(5_016);
		action.update({ ...options });
		await vi.advanceTimersByTimeAsync(20_000);
		expect(writes.map((write) => write.action)).toEqual(['claim', 'update']);
		expect(activity).toEqual([true, false]);
		setVisibility('hidden');
		setVisibility('visible');
		await vi.advanceTimersByTimeAsync(0);
		expect(writesOf('claim')).toHaveLength(2);
	});

	it('releases a lease on the machine it was claimed from when the tab changes', async () => {
		const { action, options } = mount({ tabId: 'tm-dev~w1:t1' });
		await vi.advanceTimersByTimeAsync(16);
		action.update({ ...options, tabId: 'w2:t1' });
		await vi.advanceTimersByTimeAsync(0);
		expect(writesOf('release')).toEqual([
			expect.objectContaining({ tabId: 'tm-dev~w1:t1', leaseId: 'lease-1' })
		]);
		expect(writesOf('claim').map((write) => write.tabId)).toEqual(['tm-dev~w1:t1', 'w2:t1']);
	});

	it('sends one claim at a time', async () => {
		let grant = () => {};
		respond = (write) =>
			write.action === 'claim'
				? new Promise((resolve) => (grant = () => resolve(grantAll(write))))
				: grantAll(write);
		const { action, options, activity } = mount();
		await vi.advanceTimersByTimeAsync(16);
		action.update({ ...options });
		await vi.advanceTimersByTimeAsync(1_000);
		expect(writesOf('claim')).toHaveLength(1);
		grant();
		await vi.advanceTimersByTimeAsync(0);
		expect(activity).toEqual([true]);
	});

	it('hands back a claim that lands after the page was hidden', async () => {
		let grant = () => {};
		respond = (write) =>
			write.action === 'claim'
				? new Promise((resolve) => (grant = () => resolve(grantAll(write))))
				: grantAll(write);
		const { activity } = mount();
		await vi.advanceTimersByTimeAsync(16);
		setVisibility('hidden');
		grant();
		await vi.advanceTimersByTimeAsync(0);
		expect(writesOf('release')).toEqual([
			expect.objectContaining({ tabId: 'w1:t1', leaseId: 'lease-1' })
		]);
		expect(activity).toEqual([]);
	});

	it('claims nothing once destroyed', async () => {
		const { action } = mount();
		action.destroy();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(writes).toEqual([]);
	});

	it.each([
		['a 503', () => reply(503, { message: 'herdr is not reachable' })],
		['a 400', () => reply(400, { message: 'invalid_request: unknown method' })],
		['a network error', () => Promise.reject(new TypeError('network down'))]
	])('backs off for 30 s after a claim fails with %s', async (_name, failure) => {
		respond = (write) => (write.action === 'claim' ? failure() : grantAll(write));
		const { action, options } = mount();
		await vi.advanceTimersByTimeAsync(16);
		for (let beat = 0; beat < 10; beat++) {
			action.update({ ...options });
			window.dispatchEvent(new Event('resize'));
			await vi.advanceTimersByTimeAsync(2_000);
		}
		expect(writesOf('claim')).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(writesOf('claim')).toHaveLength(2);
	});
});
