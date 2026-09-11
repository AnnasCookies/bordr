import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs: string[] = [];
function withEndpoints(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'bordr-machines-'));
	dirs.push(dir);
	const path = join(dir, 'endpoints.json');
	writeFileSync(path, contents);
	return path;
}

afterEach(() => {
	vi.resetModules();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function load(path: string, machines = 'a,b,tm-dev,hermes') {
	// Reset here, not only in afterEach: a test that loads twice would
	// otherwise get the first call's module and silently assert nothing.
	vi.resetModules();
	vi.doMock('$env/dynamic/private', () => ({
		env: { HERDR_ENDPOINTS: path, BORDR_MACHINES: machines }
	}));
	return (await import('./machines')).listMachines();
}

describe('listMachines', () => {
	it("reads herdr's own client state", async () => {
		const path = withEndpoints(
			JSON.stringify({
				version: 1,
				ssh: [
					{ id: 'a', label: 'tm-dev', target: 'tm-dev', session: 'default', enabled: true },
					{ id: 'b', label: 'hermes', target: 'hermes', session: 'default', enabled: false }
				]
			})
		);
		expect(await load(path)).toEqual([
			{ id: 'a', label: 'tm-dev', target: 'tm-dev', session: 'default', enabled: true },
			{ id: 'b', label: 'hermes', target: 'hermes', session: 'default', enabled: false }
		]);
	});

	/**
	 * The whole point of the opt-in: herdr's endpoints file is a list of
	 * machines someone once typed into a terminal, and bordr has no login, so
	 * inheriting it wholesale hands every one of them to anyone who reaches
	 * the port. Nothing is reachable until it is named here.
	 */
	it('reaches no machine at all until BORDR_MACHINES names it', async () => {
		const contents = JSON.stringify({
			version: 1,
			ssh: [
				{ id: 'a', label: 'tm-dev', target: 'tm-dev', session: 'default', enabled: true },
				{ id: 'b', label: 'hermes', target: 'hermes', session: 'default', enabled: true }
			]
		});
		for (const unset of ['', '   ', ',', ' , ']) {
			expect(await load(withEndpoints(contents), unset), JSON.stringify(unset)).toEqual([]);
		}
	});

	it('names a machine by either its id or its label', async () => {
		const contents = JSON.stringify({
			version: 1,
			ssh: [
				{ id: 'a', label: 'tm-dev', target: 'tm-dev', session: 'default', enabled: true },
				{ id: 'b', label: 'hermes', target: 'hermes', session: 'default', enabled: true }
			]
		});
		expect((await load(withEndpoints(contents), 'a')).map((m) => m.id)).toEqual(['a']);
		expect((await load(withEndpoints(contents), ' HERMES ')).map((m) => m.id)).toEqual(['b']);
		expect((await load(withEndpoints(contents), 'a,hermes')).map((m) => m.id)).toEqual(['a', 'b']);
	});

	it('is empty rather than throwing when there is no file', async () => {
		// The normal case for anyone who has never added a machine.
		expect(await load('/nowhere/endpoints.json')).toEqual([]);
	});

	it('ignores entries with no label, and a file of the wrong shape', async () => {
		expect(await load(withEndpoints(JSON.stringify({ ssh: [{ id: 'x' }] })))).toEqual([]);
		expect(await load(withEndpoints('{"ssh":"nope"}'))).toEqual([]);
		expect(await load(withEndpoints('not json'))).toEqual([]);
	});
});
