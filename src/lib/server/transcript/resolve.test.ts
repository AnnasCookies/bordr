import { expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/herdr', () => ({ getClient: () => ({ request }) }));
import { resolveLocalTranscript } from './resolve';
it('refuses every remote local-resolution caller before process or file lookup', async () => {
	const resolve = vi.fn(async () => '/local-only/session');
	const adapter = { resolve, parse: () => [] };
	for (const kind of ['omp', 'claude', 'pi']) {
		expect(
			await resolveLocalTranscript(adapter, 'remote~w1:p1', kind, '/local-only/session')
		).toBeNull();
	}
	expect(resolve).not.toHaveBeenCalled();
	expect(request).not.toHaveBeenCalled();
	expect(await resolveLocalTranscript(adapter, 'w1:p1', 'claude', '/local-only/session')).toBe(
		'/local-only/session'
	);
});
