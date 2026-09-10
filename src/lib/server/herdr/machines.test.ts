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

async function load(path: string) {
	vi.doMock('$env/dynamic/private', () => ({ env: { HERDR_ENDPOINTS: path } }));
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
