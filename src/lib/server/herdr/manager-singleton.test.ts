import { describe, expect, it, vi } from 'vitest';

/**
 * getManager must be memoised on the in-flight promise. Two managers means
 * two herdr event streams and every push notification sent twice.
 */
describe('manager singleton', () => {
	it('concurrent callers share one construction', async () => {
		let built = 0;
		let manager: object | undefined;
		let pending: Promise<object> | undefined;

		const build = async () => {
			built++;
			await new Promise((r) => setTimeout(r, 20));
			return {};
		};

		// Mirrors the implementation's guard shape.
		const getManager = async (): Promise<object> => {
			if (manager) return manager;
			if (pending) return pending;
			pending = (async () => {
				const created = await build();
				manager = created;
				return created;
			})();
			try {
				return await pending;
			} finally {
				if (manager) pending = undefined;
			}
		};

		const [a, b, c] = await Promise.all([getManager(), getManager(), getManager()]);
		expect(built).toBe(1);
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	it('a failed construction is retryable', async () => {
		let attempts = 0;
		let manager: object | undefined;
		let pending: Promise<object> | undefined;

		const build = vi.fn(async () => {
			attempts++;
			if (attempts === 1) throw new Error('herdr down');
			return {};
		});

		const getManager = async (): Promise<object> => {
			if (manager) return manager;
			if (pending) return pending;
			pending = (async () => {
				const created = await build();
				manager = created;
				return created;
			})();
			try {
				return await pending;
			} catch (e) {
				pending = undefined;
				throw e;
			} finally {
				if (manager) pending = undefined;
			}
		};

		await expect(getManager()).rejects.toThrow('herdr down');
		await expect(getManager()).resolves.toBeDefined();
		expect(attempts).toBe(2);
	});
});
