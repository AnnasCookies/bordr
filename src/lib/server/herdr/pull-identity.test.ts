import { expect, it, vi } from 'vitest';
const calls = vi.hoisted(
	() => [] as { args: string[]; done: (error: Error | null, text: string) => void }[]
);
vi.mock('node:child_process', () => ({
	execFile: (
		_file: string,
		args: string[],
		_options: unknown,
		done: (error: Error | null, text: string) => void
	) => {
		calls.push({ args, done });
	}
}));
import { pullFor } from './pulls';
it('queries and caches the displayed branch, not the mutable checkout', async () => {
	expect(pullFor(null, '/fixture/repo', 'A')).toBeNull();
	expect(pullFor(null, '/fixture/repo', 'B')).toBeNull();
	expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
		['pr', 'view', 'A'],
		['pr', 'view', 'B']
	]);
	calls[0].done(null, JSON.stringify({ number: 1 }));
	calls[1].done(null, JSON.stringify({ number: 2 }));
	await Promise.resolve();
	expect(pullFor(null, '/fixture/repo', 'A')?.number).toBe(1);
	expect(pullFor(null, '/fixture/repo', 'B')?.number).toBe(2);
	expect(calls).toHaveLength(2);
});
