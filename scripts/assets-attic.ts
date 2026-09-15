#!/usr/bin/env bun
/**
 * Keep the previous build's hashed assets alive across a rebuild.
 *
 * The problem: `vite build` empties the output, so every `_app/immutable/*`
 * file from the last build disappears. The installed app stays open for days
 * and navigates without a full load, so the moment it asks for a route chunk
 * it has not loaded yet, that chunk 404s. Reproduced: rebuild under an open
 * page, tap an agent, and the page pulls a 404 on
 * `_app/immutable/nodes/3.<hash>.js` — and version polling only notices on
 * its own 30-second beat, so there is a window where the app is simply
 * broken for whoever is holding it.
 *
 * Content-hashed files are safe to keep by definition — the hash IS the
 * content, so an old file can never be wrong. Keeping them is the normal way
 * to deploy a single-page app; deleting them is the thing that breaks open
 * clients.
 *
 *   stash    before the build: fold what is there now into the attic
 *   restore  after it: put back anything the new build does not have
 *
 * Bounded by retirement age rather than build age: the emitted set gets a
 * week of grace when replaced; inherited chunks keep their original deadline.
 */

import { cp, mkdir, readdir, rm, stat, utimes, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const OUT = process.env.BORDR_BUILD_OUT ?? 'build';
const LIVE = join(OUT, 'client', '_app', 'immutable');
/**
 * One attic per output directory.
 *
 * The e2e suite builds to `.e2e-build` precisely so it never disturbs the
 * live `build/` — and a shared attic undid that, putting thousands of the
 * live build's chunks into the test one. Two builds' assets in a single tree
 * is the confusion this script exists to prevent, not to create.
 */
const ATTIC = join('.attic', OUT.replace(/[^\w.-]/g, '_'), 'immutable');
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** Every file under a directory, as paths relative to it. */
export async function walk(root: string, base = root): Promise<string[]> {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) out.push(...(await walk(path, base)));
		else out.push(relative(base, path));
	}
	return out;
}

/** Emitted assets, not inherited attic files. Missing manifest is a one-time legacy release. */
export async function emittedAssets(out: string): Promise<Set<string>> {
	try {
		return new Set(JSON.parse(await readFile(join(out, '.emitted-assets.json'), 'utf8')));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		return new Set(await walk(join(out, 'client', '_app', 'immutable')));
	}
}

async function stash(): Promise<void> {
	const files = await walk(LIVE);
	const emitted = await emittedAssets(OUT);
	let added = 0;
	for (const file of files) {
		const to = join(ATTIC, file);
		await mkdir(dirname(to), { recursive: true });
		if (emitted.has(file) || !existsSync(to)) {
			await cp(join(LIVE, file), to, { preserveTimestamps: true });
			if (emitted.has(file)) {
				const now = new Date();
				await utimes(to, now, now);
			}
			added += 1;
		}
	}

	let pruned = 0;
	for (const file of await walk(ATTIC)) {
		const path = join(ATTIC, file);
		if (Date.now() - (await stat(path)).mtimeMs > KEEP_MS) {
			await rm(path);
			pruned += 1;
		}
	}
	console.error(`assets-attic: kept ${files.length} (+${added} new, -${pruned} stale)`);
}

async function restore(): Promise<void> {
	await writeFile(join(OUT, '.emitted-assets.json'), JSON.stringify(await walk(LIVE)));
	// Before restoring old chunks, refresh only files this build actually emitted.
	for (const file of await walk(LIVE)) {
		const to = join(ATTIC, file);
		await mkdir(dirname(to), { recursive: true });
		await cp(join(LIVE, file), to);
		const now = new Date();
		await utimes(to, now, now);
	}
	let put = 0;
	for (const file of await walk(ATTIC)) {
		const from = join(ATTIC, file);
		if (Date.now() - (await stat(from)).mtimeMs > KEEP_MS) {
			await rm(from);
			continue;
		}
		const to = join(LIVE, file);
		if (existsSync(to)) continue;
		await mkdir(dirname(to), { recursive: true });
		await cp(from, to, { preserveTimestamps: true });
		put += 1;
	}
	console.error(`assets-attic: put back ${put} asset(s) an open page may still want`);
}

if (import.meta.main) {
	const mode = process.argv[2];
	if (mode === 'stash') await stash();
	else if (mode === 'restore') await restore();
	else {
		console.error('usage: assets-attic.ts stash|restore');
		process.exit(2);
	}
}
