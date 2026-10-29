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
 *   adopt    before a deploy build: fold the running release's into the attic
 *   stash    before the build: fold what is there now into the attic
 *   restore  after it: put back anything the new build does not have
 *
 * Bounded by retirement age rather than build age: the emitted set gets a
 * week of grace when replaced; inherited chunks keep their original deadline.
 */

import { cp, mkdir, readdir, rm, stat, utimes, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
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
/** What the adapter step saw the build emit, for `restore` to pick up. */
export const EMITTED_HANDOFF = '.emitted-by-build.json';

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

/**
 * Fold the running release's hashed assets into the attic.
 *
 * publish-build.ts copies them into each new release as well, but that copy
 * lands after the Bun adapter has listed what it will serve, so a chunk that
 * only the running release had would 404. The same retirement rule as that
 * copy: what the release emitted starts its week now, and anything it was
 * already keeping only stays while its own week lasts.
 */
async function adopt(live: string): Promise<void> {
	const from = join(live, 'client', '_app', 'immutable');
	if (!existsSync(from)) return;
	const emitted = await emittedAssets(live);
	let added = 0;
	for (const file of await walk(from)) {
		const to = join(ATTIC, file);
		if (existsSync(to)) continue;
		const source = join(from, file);
		const retiring = emitted.has(file);
		if (!retiring && Date.now() - (await stat(source)).mtimeMs > KEEP_MS) continue;
		await mkdir(dirname(to), { recursive: true });
		await cp(source, to, { preserveTimestamps: true });
		if (retiring) {
			const now = new Date();
			await utimes(to, now, now);
		}
		added += 1;
	}
	console.error(`assets-attic: adopted ${added} asset(s) from the running release`);
}

/**
 * Copy every unexpired attic file that `into` lacks, pruning expired ones.
 *
 * Runs twice per build. The Bun adapter serves only the files it listed at
 * build time, so vite.config.ts calls this on SvelteKit's client output
 * before the adapter writes that list; `restore` calls it again on the output
 * for anything a release copy left out.
 */
export async function putBack(into: string): Promise<number> {
	let put = 0;
	for (const file of await walk(ATTIC)) {
		const from = join(ATTIC, file);
		if (Date.now() - (await stat(from)).mtimeMs > KEEP_MS) {
			await rm(from);
			continue;
		}
		const to = join(into, file);
		if (existsSync(to)) continue;
		await mkdir(dirname(to), { recursive: true });
		await cp(from, to, { preserveTimestamps: true });
		put += 1;
	}
	return put;
}

async function restore(): Promise<void> {
	// The adapter step hands over what the build emitted before the attic's
	// files joined it. Read once and removed, so a build that wrote none can
	// never inherit the last one's; without it, everything on disk is new.
	const handoff = join(OUT, EMITTED_HANDOFF);
	const emitted: string[] = existsSync(handoff)
		? JSON.parse(await readFile(handoff, 'utf8'))
		: await walk(LIVE);
	await rm(handoff, { force: true });
	await writeFile(join(OUT, '.emitted-assets.json'), JSON.stringify(emitted));
	// Before restoring old chunks, refresh only files this build actually emitted.
	for (const file of emitted) {
		const to = join(ATTIC, file);
		await mkdir(dirname(to), { recursive: true });
		await cp(join(LIVE, file), to);
		const now = new Date();
		await utimes(to, now, now);
	}
	const put = await putBack(LIVE);
	console.error(`assets-attic: put back ${put} asset(s) an open page may still want`);
}

if (import.meta.main) {
	const mode = process.argv[2];
	if (mode === 'adopt')
		await adopt(process.env.BORDR_LIVE_DIR ?? join(homedir(), '.local', 'lib', 'bordr'));
	else if (mode === 'stash') await stash();
	else if (mode === 'restore') await restore();
	else {
		console.error('usage: assets-attic.ts adopt|stash|restore');
		process.exit(2);
	}
}
