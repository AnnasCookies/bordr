import { describe, expect, it } from 'vitest';
import { netBusy, resetPending, track } from './pending.svelte';

/** A promise this test controls the settling of. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('track', () => {
	it('is busy for exactly as long as the request is in flight', async () => {
		resetPending();
		expect(netBusy.active).toBe(false);

		const one = deferred<string>();
		const run = track(() => one.promise);
		expect(netBusy.active).toBe(true);

		one.resolve('done');
		await expect(run).resolves.toBe('done');
		expect(netBusy.active).toBe(false);
	});

	/**
	 * The failure mode this guards is a progress bar pinned on for the life of
	 * the page: a request that throws must still be counted out.
	 */
	it('stops counting a request that failed, and rethrows it', async () => {
		resetPending();
		const bad = deferred<string>();
		const run = track(() => bad.promise);
		expect(netBusy.active).toBe(true);

		bad.reject(new Error('offline'));
		await expect(run).rejects.toThrow('offline');
		expect(netBusy.active).toBe(false);
	});

	it('stays busy while any one of several is still going', async () => {
		resetPending();
		const first = deferred<number>();
		const second = deferred<number>();
		const a = track(() => first.promise);
		const b = track(() => second.promise);

		first.resolve(1);
		await a;
		// One settled, one outstanding: still busy.
		expect(netBusy.active).toBe(true);

		second.resolve(2);
		await b;
		expect(netBusy.active).toBe(false);
	});
});
