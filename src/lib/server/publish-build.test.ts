import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishBuild } from '../../../scripts/publish-build';

it('failed install leaves the active entry, routes, dependencies and version unchanged', async () => {
	const root = await mkdtemp(join(tmpdir(), 'bordr-publish-'));
	const out = join(root, 'build');
	const live = join(root, 'live');
	const migration = { stop: async () => {}, start: async () => {} };
	try {
		await mkdir(out);
		await mkdir(live);
		const files = [
			'index.js',
			'route.js',
			'node_modules/fixture/index.js',
			'client/_app/version.json'
		];
		for (const file of files) {
			for (const dir of [out, live]) {
				await mkdir(join(dir, file, '..'), { recursive: true });
				await writeFile(join(dir, file), dir === out ? 'new' : 'active');
			}
		}
		await writeFile(join(root, 'package.json'), '{}');
		await writeFile(join(root, 'bun.lock'), 'fixture');
		await expect(
			publishBuild(
				out,
				live,
				async () => {
					throw new Error('install failed');
				},
				root,
				migration
			)
		).rejects.toThrow('install failed');
		for (const file of files) expect(await readFile(join(live, file), 'utf8')).toBe('active');
		expect(await readdir(`${live}.releases`)).toEqual([]);
		const release = await publishBuild(out, live, async () => {}, root, migration);
		expect(await readFile(join(live, 'index.js'), 'utf8')).toBe('new');
		expect(await readFile(join(`${release}-previous`, 'index.js'), 'utf8')).toBe('active');
		await expect(
			publishBuild(
				out,
				live,
				async () => {
					throw new Error('second failure');
				},
				root
			)
		).rejects.toThrow('second failure');
		expect(await readFile(join(live, 'index.js'), 'utf8')).toBe('new');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it('requires explicit stopped migration and restores the old pathname on activation failure', async () => {
	const root = await mkdtemp(join(tmpdir(), 'bordr-migration-'));
	const out = join(root, 'build');
	const live = join(root, 'live');
	try {
		await mkdir(out);
		await mkdir(live);
		await writeFile(join(root, 'package.json'), '{}');
		await writeFile(join(root, 'bun.lock'), 'fixture');
		await writeFile(join(out, 'index.js'), 'new');
		await writeFile(join(live, 'index.js'), 'old');
		await writeFile(join(live, 'route-old.js'), 'lazy old route');
		await expect(publishBuild(out, live, async () => {}, root)).rejects.toThrow('--migrate');
		let stopped = false;
		let starts = 0;
		await expect(
			publishBuild(
				out,
				live,
				async () => {
					expect(stopped).toBe(false);
					expect(await readFile(join(live, 'route-old.js'), 'utf8')).toBe('lazy old route');
				},
				root,
				{
					stop: async () => {
						stopped = true;
					},
					start: async () => {
						expect(stopped).toBe(true);
						starts++;
						if (starts === 1) {
							expect(await readFile(join(live, 'index.js'), 'utf8')).toBe('new');
							throw new Error('activation failed');
						}
						expect(await readFile(join(live, 'route-old.js'), 'utf8')).toBe('lazy old route');
					}
				}
			)
		).rejects.toThrow('activation failed');
		expect(starts).toBe(2);
		expect(await readFile(join(live, 'index.js'), 'utf8')).toBe('old');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it('retires active emitted chunks now, but does not renew inherited chunks', async () => {
	const { utimes, stat } = await import('node:fs/promises');
	const root = await mkdtemp(join(tmpdir(), 'bordr-retirement-'));
	const out = join(root, 'build');
	const live = join(root, 'live');
	const asset = 'client/_app/immutable';
	try {
		await mkdir(join(out, asset), { recursive: true });
		await writeFile(join(root, 'package.json'), '{}');
		await writeFile(join(root, 'bun.lock'), 'fixture');
		await writeFile(join(out, 'index.js'), 'fixture');
		await writeFile(join(out, asset, 'current.js'), 'current');
		await publishBuild(out, live, async () => {}, root);
		await writeFile(join(live, asset, 'inherited.js'), 'inherited');
		const old = new Date(Date.now() - 8 * 86400_000);
		for (const file of ['current.js', 'inherited.js'])
			await utimes(join(live, asset, file), old, old);
		await rm(join(out, asset, 'current.js'));
		await writeFile(join(out, asset, 'next.js'), 'next');
		await publishBuild(out, live, async () => {}, root);
		expect(await readFile(join(live, asset, 'current.js'), 'utf8')).toBe('current');
		expect(Date.now() - (await stat(join(live, asset, 'current.js'))).mtimeMs).toBeLessThan(10000);
		await expect(stat(join(live, asset, 'inherited.js'))).rejects.toThrow();
		await utimes(join(live, asset, 'current.js'), old, old);
		await publishBuild(out, live, async () => {}, root);
		await expect(stat(join(live, asset, 'current.js'))).rejects.toThrow();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
