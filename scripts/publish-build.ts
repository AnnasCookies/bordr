#!/usr/bin/env bun
/**
 * Copy the build to the directory the service runs, with its own dependencies.
 *
 * `build/` is rewritten by every `bun run build`, and CI and each local check
 * run one. With the unit serving `build/` directly, a check swapped client
 * assets under a running server. `bun run deploy` is the only caller.
 *
 * svelte-adapter-bun leaves `dependencies` external, so `index.js` imports
 * web-push, marked and the rest from a node_modules it resolves beside itself.
 * A bare copy has none. Bun then quietly auto-installs whatever its global cache
 * holds, unpinned by the lockfile, and with no cache and no network the server
 * does not start at all. Installing from the lockfile makes the copy stand alone.
 *
 * The service's working directory stays the checkout: `.env`, the default data
 * directory and the omp startup extension are all resolved against it.
 */

import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

const OUT = process.env.BORDR_BUILD_OUT ?? 'build';
const LIVE_DIR = process.env.BORDR_LIVE_DIR ?? join(homedir(), '.local', 'lib', 'bordr');
/** Belongs to the copy, not the build, so the mirror below leaves it alone. */
const OWN = new Set(['node_modules', 'package.json', 'bun.lock']);

/** Every file under a directory, as paths relative to it, skipping `skip` at the top. */
async function walk(root: string, skip: Set<string>, base = root): Promise<string[]> {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (root === base && skip.has(entry.name)) continue;
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(path, skip, base)));
		else files.push(relative(base, path));
	}
	return files;
}

if (!existsSync(join(OUT, 'index.js'))) {
	console.error(`publish-build: no ${join(OUT, 'index.js')}; run the build first`);
	process.exit(1);
}

await mkdir(LIVE_DIR, { recursive: true });
await cp(OUT, LIVE_DIR, { recursive: true, force: true, preserveTimestamps: true });

// A mirror, so old server chunks do not pile up deploy after deploy. Safe for a
// page still open on the previous build: the build step's asset attic has
// already put that build's hashed client chunks back into OUT, for a week.
const built = new Set(await walk(OUT, new Set()));
let pruned = 0;
for (const file of await walk(LIVE_DIR, OWN)) {
	if (built.has(file)) continue;
	await rm(join(LIVE_DIR, file));
	pruned += 1;
}

await cp('package.json', join(LIVE_DIR, 'package.json'));
await cp('bun.lock', join(LIVE_DIR, 'bun.lock'));
// --ignore-scripts: the checkout's `prepare` runs svelte-kit sync, which has no
// sources to sync here.
const install = Bun.spawnSync(
	[process.execPath, 'install', '--production', '--frozen-lockfile', '--ignore-scripts'],
	{ cwd: LIVE_DIR, stdout: 'inherit', stderr: 'inherit' }
);
if (install.exitCode !== 0) {
	console.error(`publish-build: bun install failed in ${LIVE_DIR} (exit ${install.exitCode})`);
	process.exit(1);
}

console.error(`publish-build: ${OUT} -> ${LIVE_DIR} (${built.size} files, -${pruned} stale)`);
