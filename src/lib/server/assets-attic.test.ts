import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('does not rejuvenate a restored chunk during the next build cycle', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'bordr-attic-'));
	const script = resolve('scripts/assets-attic.ts');
	const live = join(dir, 'build/client/_app/immutable');
	const attic = join(dir, '.attic/build/immutable');
	const run = (mode: string) =>
		execFileSync('bun', [script, mode], {
			cwd: dir,
			env: { ...process.env, BORDR_BUILD_OUT: 'build' },
			stdio: 'pipe'
		});
	try {
		await mkdir(live, { recursive: true });
		await writeFile(join(live, 'old.js'), 'old');
		run('stash');
		await rm(live, { recursive: true });
		await mkdir(live, { recursive: true });
		await writeFile(join(live, 'new.js'), 'new');
		run('restore');
		const aged = new Date(Date.now() - 8 * 86400_000);
		await utimes(join(attic, 'old.js'), aged, aged);
		run('stash');
		await rm(live, { recursive: true });
		await mkdir(live, { recursive: true });
		await writeFile(join(live, 'new.js'), 'new');
		run('restore');
		await expect(stat(join(live, 'old.js'))).rejects.toThrow();
		expect((await stat(join(live, 'new.js'))).isFile()).toBe(true);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it('keeps the emitted set of a quiet active build through a retirement grace period', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'bordr-attic-quiet-'));
	const script = resolve('scripts/assets-attic.ts');
	const live = join(dir, 'build/client/_app/immutable');
	const run = (mode: string) =>
		execFileSync('bun', [script, mode], {
			cwd: dir,
			env: { ...process.env, BORDR_BUILD_OUT: 'build' },
			stdio: 'pipe'
		});
	try {
		await mkdir(live, { recursive: true });
		await writeFile(join(live, 'active.js'), 'active');
		run('restore');
		const aged = new Date(Date.now() - 8 * 86400_000);
		await utimes(join(live, 'active.js'), aged, aged);
		await utimes(join(dir, '.attic/build/immutable/active.js'), aged, aged);
		run('stash');
		await rm(live, { recursive: true });
		await mkdir(live, { recursive: true });
		await writeFile(join(live, 'next.js'), 'next');
		run('restore');
		expect((await stat(join(live, 'active.js'))).isFile()).toBe(true);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it('records only what the build emitted, once, when the adapter step hands it over', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'bordr-attic-handoff-'));
	const script = resolve('scripts/assets-attic.ts');
	const live = join(dir, 'build/client/_app/immutable');
	const run = (mode: string) =>
		execFileSync('bun', [script, mode], {
			cwd: dir,
			env: { ...process.env, BORDR_BUILD_OUT: 'build' },
			stdio: 'pipe'
		});
	const recorded = async () =>
		JSON.parse(await readFile(join(dir, 'build/.emitted-assets.json'), 'utf8'));
	try {
		// The attic's chunk is already beside the new one, as the adapter
		// step leaves it; only new.js was the build's own.
		await mkdir(live, { recursive: true });
		await writeFile(join(live, 'new.js'), 'new');
		await writeFile(join(live, 'old.js'), 'old');
		await writeFile(join(dir, 'build/.emitted-by-build.json'), JSON.stringify(['new.js']));
		run('restore');
		expect(await recorded()).toEqual(['new.js']);
		await expect(stat(join(dir, 'build/.emitted-by-build.json'))).rejects.toThrow();

		// A later run with no handoff must not reuse the last one.
		run('restore');
		expect((await recorded()).sort()).toEqual(['new.js', 'old.js']);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

it("adopts the running release's chunks before a deploy build, by its retirement rule", async () => {
	const dir = await mkdtemp(join(tmpdir(), 'bordr-attic-adopt-'));
	const script = resolve('scripts/assets-attic.ts');
	const live = join(dir, 'live');
	const chunks = join(live, 'client/_app/immutable');
	const attic = join(dir, '.attic/build/immutable');
	try {
		await mkdir(chunks, { recursive: true });
		await writeFile(join(chunks, 'emitted.js'), 'emitted');
		await writeFile(join(chunks, 'kept.js'), 'kept');
		await writeFile(join(chunks, 'expired.js'), 'expired');
		await writeFile(join(live, '.emitted-assets.json'), JSON.stringify(['emitted.js']));
		const aged = new Date(Date.now() - 8 * 86400_000);
		await utimes(join(chunks, 'emitted.js'), aged, aged);
		await utimes(join(chunks, 'expired.js'), aged, aged);
		execFileSync('bun', [script, 'adopt'], {
			cwd: dir,
			env: { ...process.env, BORDR_BUILD_OUT: 'build', BORDR_LIVE_DIR: live },
			stdio: 'pipe'
		});
		// Emitted by the running release: its week starts now, however old.
		expect(Date.now() - (await stat(join(attic, 'emitted.js'))).mtimeMs).toBeLessThan(60_000);
		expect((await stat(join(attic, 'kept.js'))).isFile()).toBe(true);
		await expect(stat(join(attic, 'expired.js'))).rejects.toThrow();
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
