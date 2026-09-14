import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The route with herdr and the command scan doubled: only its decision is under test. */
const doubles = vi.hoisted(() => ({
	rawAgent: vi.fn(
		async () =>
			({ agent: 'omp', cwd: '/home/someone/project' }) as null | {
				agent: string;
				cwd: string;
			}
	),
	commandsFor: vi.fn(async () => [])
}));
vi.mock('$lib/server/herdr', () => ({ rawAgent: doubles.rawAgent }));
vi.mock('$lib/server/commands', () => ({ commandsFor: doubles.commandsFor }));

async function get(pane: string) {
	const { GET } = await import('./+server');
	return GET({ params: { pane } } as never);
}

beforeEach(() => {
	doubles.commandsFor.mockClear();
});

describe('commands route', () => {
	/**
	 * The cwd of a pane on another machine is that machine's word about a path
	 * on that machine; the scan runs here, so it must be told.
	 */
	it('marks a pane on another machine as remote', async () => {
		await get('tm-dev~w8:p1');
		expect(doubles.commandsFor).toHaveBeenCalledWith('omp', '/home/someone/project', {
			remote: true
		});
	});

	it('treats a bare pane id as local', async () => {
		await get('w8:p1');
		expect(doubles.commandsFor).toHaveBeenCalledWith('omp', '/home/someone/project', {
			remote: false
		});
	});
});
