import { expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishBuild } from '../../../scripts/publish-build';

it('failed install leaves the active entry, routes, dependencies and version unchanged', async () => {
	const root = await mkdtemp(join(tmpdir(), 'bordr-publish-'));
	const out = join(root, 'build');
	const live = join(root, 'live');
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
				root
			)
		).rejects.toThrow('install failed');
		for (const file of files) expect(await readFile(join(live, file), 'utf8')).toBe('active');
		expect(await readdir(`${live}.releases`)).toEqual([]);
		const release = await publishBuild(out, live, async () => {}, root);
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
