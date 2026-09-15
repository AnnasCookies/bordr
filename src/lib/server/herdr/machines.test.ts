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

/**
 * Everything `listMachines` reads from the environment. HOST is deliberately
 * absent unless a test names it: with no bind to vouch for, nothing is
 * inherited, so a test about narrowing cannot pass by accident through the
 * inherit branch.
 */
async function load(path: string, env: Record<string, string> = {}) {
	// Reset here, not only in afterEach: a test that loads twice would
	// otherwise get the first call's module and silently assert nothing.
	vi.resetModules();
	vi.doMock('$env/dynamic/private', () => ({
		env: { HERDR_ENDPOINTS: path, BORDR_MACHINES: 'a,b,tm-dev,hermes', ...env }
	}));
	return (await import('./machines')).listMachines();
}

const TWO_MACHINES = JSON.stringify({
	version: 1,
	ssh: [
		{ id: 'a', label: 'tm-dev', target: 'tm-dev', session: 'default', enabled: true },
		{ id: 'b', label: 'hermes', target: 'hermes', session: 'default', enabled: true }
	]
});

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
	 * With no list, what is reachable depends on the bind (`machinesInherit`).
	 * A bind nobody can vouch for — HOST unset, which svelte-adapter-bun turns
	 * into every interface — inherits nothing.
	 */
	it('reaches no machine without BORDR_MACHINES when the bind cannot be vouched for', async () => {
		for (const unset of ['', '   ', ',', ' , ']) {
			expect(
				await load(withEndpoints(TWO_MACHINES), { BORDR_MACHINES: unset }),
				JSON.stringify(unset)
			).toEqual([]);
		}
	});

	/**
	 * Loopback, no flag, no proxy host: whoever can reach bordr is whoever can
	 * already use herdr on this host, so herdr's own list is the grant.
	 */
	it('inherits every machine on a loopback bind with BORDR_MACHINES empty', async () => {
		for (const unset of ['', ' , ']) {
			const machines = await load(withEndpoints(TWO_MACHINES), {
				HOST: '127.0.0.1',
				BORDR_MACHINES: unset
			});
			expect(
				machines.map((m) => m.id),
				JSON.stringify(unset)
			).toEqual(['a', 'b']);
		}
	});

	/** The no-auth flag means bordr was bound somewhere wider; the list must be explicit. */
	it('inherits nothing once the no-auth flag is set', async () => {
		expect(
			await load(withEndpoints(TWO_MACHINES), {
				HOST: '127.0.0.1',
				BORDR_MACHINES: '',
				BORDR_I_UNDERSTAND_THIS_HAS_NO_AUTH: '1'
			})
		).toEqual([]);
	});

	/** A proxy on your own domain admits a wider set than the tailnet. */
	it('inherits nothing once BORDR_ALLOWED_HOSTS names a proxy', async () => {
		expect(
			await load(withEndpoints(TWO_MACHINES), {
				HOST: '127.0.0.1',
				BORDR_MACHINES: '',
				BORDR_ALLOWED_HOSTS: 'bordr.example.com'
			})
		).toEqual([]);
	});

	/** Naming machines narrows even a bind that would otherwise inherit them all. */
	it('narrows an inheriting bind to the machines BORDR_MACHINES names', async () => {
		const machines = await load(withEndpoints(TWO_MACHINES), {
			HOST: '127.0.0.1',
			BORDR_MACHINES: 'hermes'
		});
		expect(machines.map((m) => m.id)).toEqual(['b']);
	});

	it('names a machine by either its id or its label', async () => {
		expect(
			(await load(withEndpoints(TWO_MACHINES), { BORDR_MACHINES: 'a' })).map((m) => m.id)
		).toEqual(['a']);
		expect(
			(await load(withEndpoints(TWO_MACHINES), { BORDR_MACHINES: ' HERMES ' })).map((m) => m.id)
		).toEqual(['b']);
		expect(
			(await load(withEndpoints(TWO_MACHINES), { BORDR_MACHINES: 'a,hermes' })).map((m) => m.id)
		).toEqual(['a', 'b']);
	});

	/**
	 * ssh is handed the target as an argument, so one beginning with `-` would
	 * be read as an option: `-oProxyCommand=…` runs a local command.
	 */
	it('refuses a target ssh could read as an option, or one with whitespace or control characters', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const contents = JSON.stringify({
				version: 1,
				ssh: [
					{ id: 'ok', label: 'ok', target: 'user@tm-dev.tail1234.ts.net' },
					{ id: 'opt', label: 'opt', target: '-oProxyCommand=touch /tmp/pwned' },
					{ id: 'dash', label: 'dash', target: '-p2222' },
					{ id: 'space', label: 'space', target: 'tm-dev -oProxyCommand=x' },
					{ id: 'tab', label: 'tab', target: 'tm-dev\tx' },
					{ id: 'newline', label: 'newline', target: 'tm-dev\nx' },
					{ id: 'nul', label: 'nul', target: `tm-dev${String.fromCharCode(0)}x` },
					{ id: 'del', label: 'del', target: `tm-dev${String.fromCharCode(0x7f)}x` }
				]
			});
			const machines = await load(withEndpoints(contents), {
				BORDR_MACHINES: 'ok,opt,dash,space,tab,newline,nul,del'
			});
			expect(machines.map((m) => m.id)).toEqual(['ok']);
			expect(warn).toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
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
