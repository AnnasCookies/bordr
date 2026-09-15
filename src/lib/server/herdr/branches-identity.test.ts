import { expect, it, vi } from 'vitest';
const run = vi.hoisted(() =>
	vi.fn(
		async (machine: { target: string; session: string }) =>
			`/repo\t${machine.target}-${machine.session}\t\t\t0\t0`
	)
);
vi.mock('./connections', async (original) => ({
	...(await original<typeof import('./connections')>()),
	runOn: run
}));
import { branchesFor } from './branches';
it('keys warm branch caches by target and session rather than editable id', async () => {
	const machine = { id: 'remote', label: 'Fixture', target: 'old', session: 'one', enabled: true };
	for (const change of [{}, { target: 'new' }, { session: 'two' }]) {
		Object.assign(machine, change);
		expect((await branchesFor(machine, ['/repo'])).get('/repo')?.branch).toBe(
			`${machine.target}-${machine.session}`
		);
	}
	expect(run).toHaveBeenCalledTimes(3);
});
