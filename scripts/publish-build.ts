#!/usr/bin/env bun
/** Publish a self-contained locked release, switching only after staging succeeds. */
import { cp, mkdir, mkdtemp, lstat, rename, rm, symlink, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export async function publishBuild(
	out: string,
	live: string,
	install: (release: string) => Promise<void>,
	root = '.'
): Promise<string> {
	if (!existsSync(join(out, 'index.js')))
		throw new Error(`no ${join(out, 'index.js')}; run the build first`);
	live = resolve(live);
	const releases = `${live}.releases`;
	await mkdir(releases, { recursive: true });
	const release = await mkdtemp(join(releases, 'release-'));
	const next = `${release}.link`;
	let previous = '';
	try {
		await cp(out, release, { recursive: true, preserveTimestamps: true });
		await cp(join(root, 'package.json'), join(release, 'package.json'));
		await cp(join(root, 'bun.lock'), join(release, 'bun.lock'));
		await install(release);
		// Open clients may still request the active release's hashed assets.
		const assets = join(live, 'client', '_app', 'immutable');
		if (existsSync(assets))
			await cp(assets, join(release, 'client', '_app', 'immutable'), {
				recursive: true,
				force: false,
				preserveTimestamps: true,
				filter: async (path) => {
					const info = await stat(path);
					return info.isDirectory() || Date.now() - info.mtimeMs < 7 * 86400_000;
				}
			});
		await mkdir(dirname(live), { recursive: true });
		await symlink(release, next);
		// One-time migration from the old directory publisher. Roll back if switching fails.
		if (existsSync(live) && !(await lstat(live)).isSymbolicLink()) {
			previous = `${release}-previous`;
			await rename(live, previous);
		}
		try {
			await rename(next, live);
		} catch (error) {
			if (previous) await rename(previous, live);
			throw error;
		}
		// ponytail: retain releases for running processes/rollback; prune only after verifying no service uses them.
		return release;
	} catch (error) {
		await rm(next, { force: true });
		await rm(release, { recursive: true, force: true });
		throw error;
	}
}

if (import.meta.main) {
	const out = process.env.BORDR_BUILD_OUT ?? 'build';
	const live = process.env.BORDR_LIVE_DIR ?? join(homedir(), '.local', 'lib', 'bordr');
	const release = await publishBuild(out, live, async (cwd) => {
		const install = spawnSync(
			process.execPath,
			['install', '--production', '--frozen-lockfile', '--ignore-scripts'],
			{ cwd, stdio: 'inherit' }
		);
		if (install.status !== 0) throw new Error(`bun install failed (exit ${install.status})`);
	});
	console.error(`publish-build: ${out} -> ${live} (${release})`);
}
