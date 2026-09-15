#!/usr/bin/env bun
/** Publish a self-contained locked release, switching only after staging succeeds. */
import {
	cp,
	mkdir,
	mkdtemp,
	lstat,
	rename,
	rm,
	symlink,
	stat,
	utimes,
	writeFile
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';

import { emittedAssets, walk } from './assets-attic';

export async function publishBuild(
	out: string,
	live: string,
	install: (release: string) => Promise<void>,
	root = '.',
	migration?: { stop: () => Promise<void>; start: () => Promise<void> }
): Promise<string> {
	if (!existsSync(join(out, 'index.js')))
		throw new Error(`no ${join(out, 'index.js')}; run the build first`);
	live = resolve(live);
	const releases = `${live}.releases`;
	await mkdir(releases, { recursive: true });
	const release = await mkdtemp(join(releases, 'release-'));
	const next = `${release}.link`;
	let previous = '';
	let stopped = false;
	const directory = existsSync(live) && !(await lstat(live)).isSymbolicLink();
	if (directory && !migration) {
		await rm(release, { recursive: true, force: true });
		throw new Error('live is a real directory; use --migrate for staged stop/switch/start');
	}
	try {
		await cp(out, release, { recursive: true, preserveTimestamps: true });
		await cp(join(root, 'package.json'), join(release, 'package.json'));
		await cp(join(root, 'bun.lock'), join(release, 'bun.lock'));
		await install(release);
		// Open clients may still request the active release's hashed assets.
		const assets = join(live, 'client', '_app', 'immutable');
		const emitted = await emittedAssets(live);
		if (existsSync(assets))
			await cp(assets, join(release, 'client', '_app', 'immutable'), {
				recursive: true,
				force: false,
				preserveTimestamps: true,
				filter: async (path) => {
					const info = await stat(path);
					return (
						info.isDirectory() ||
						emitted.has(relative(assets, path)) ||
						Date.now() - info.mtimeMs < 7 * 86400_000
					);
				}
			});
		// Retirement starts now, even when the active build was emitted weeks ago.
		const own = await emittedAssets(out);
		await writeFile(join(release, '.emitted-assets.json'), JSON.stringify([...own]));
		for (const file of await walk(assets)) {
			if (emitted.has(file) && !own.has(file)) {
				const now = new Date();
				await utimes(join(release, 'client', '_app', 'immutable', file), now, now);
			}
		}
		await mkdir(dirname(live), { recursive: true });
		await symlink(release, next);
		// A process loaded from a real pathname must stop before that pathname changes.
		if (directory) {
			await migration!.stop();
			stopped = true;
			previous = `${release}-previous`;
			await rename(live, previous);
		}
		await rename(next, live);
		if (stopped) await migration!.start();
		// ponytail: retain releases for running processes/rollback; prune only after verifying no service uses them.
		return release;
	} catch (error) {
		if (stopped) {
			if (previous && existsSync(previous)) {
				await rm(live, { force: true });
				await rename(previous, live);
			}
			await migration!.start();
		}
		await rm(next, { force: true });
		await rm(release, { recursive: true, force: true });
		throw error;
	}
}

if (import.meta.main) {
	const out = process.env.BORDR_BUILD_OUT ?? 'build';
	const live = process.env.BORDR_LIVE_DIR ?? join(homedir(), '.local', 'lib', 'bordr');
	const service = async (action: string) => {
		const result = spawnSync('systemctl', ['--user', action, 'bordr'], { stdio: 'inherit' });
		if (result.status !== 0) throw new Error(`bordr ${action} failed`);
	};
	const release = await publishBuild(
		out,
		live,
		async (cwd) => {
			const install = spawnSync(
				process.execPath,
				['install', '--production', '--frozen-lockfile', '--ignore-scripts'],
				{ cwd, stdio: 'inherit' }
			);
			if (install.status !== 0) throw new Error(`bun install failed (exit ${install.status})`);
		},
		'.',
		process.argv.includes('--migrate')
			? { stop: () => service('stop'), start: () => service('start') }
			: undefined
	);
	console.error(`publish-build: ${out} -> ${live} (${release})`);
}
