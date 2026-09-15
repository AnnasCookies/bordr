import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, utimes, stat } from 'node:fs/promises';
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
