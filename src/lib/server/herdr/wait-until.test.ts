import { expect, it, vi } from 'vitest';
import { waitUntil } from './index';
vi.mock('./machines', () => ({ listMachines: () => [], setCoreMachines: () => {} }));

it('returns as soon as the check says done, not at the deadline', async () => {
	let calls = 0;
	const started = Date.now();
	expect(await waitUntil(async () => ++calls >= 2, 2_000, 10)).toBe(true);
	expect(calls).toBe(2);
	expect(Date.now() - started).toBeLessThan(500);
});

it('gives up at the deadline, and a throwing check counts as not done', async () => {
	const started = Date.now();
	expect(
		await waitUntil(
			async () => {
				throw new Error('herdr hiccup');
			},
			100,
			10
		)
	).toBe(false);
	expect(Date.now() - started).toBeGreaterThanOrEqual(100);
});
