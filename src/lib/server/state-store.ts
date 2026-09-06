import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Overridable so tests never touch live state: the service's
 * WorkingDirectory is this same checkout, and vitest wiping .data/ silently
 * cancelled every done-watch and could destroy push-subscriptions.json.
 */
export const DATA_DIR = process.env.BORDR_DATA_DIR ?? join(process.cwd(), '.data');

/** Tiny file-backed JSON store — read state, done-watches. Synchronous on
 *  purpose: values are small and writes are rare. */
export function loadJson<T>(name: string, fallback: T): T {
	try {
		return JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')) as T;
	} catch {
		return fallback;
	}
}

export function saveJson(name: string, value: unknown): void {
	mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
	writeFileSync(join(DATA_DIR, name), JSON.stringify(value, null, '\t'), { mode: 0o600 });
}

// --- read state: pane -> highest state_change_seq the user has seen ---

const READ_FILE = 'read-state.json';

export function readState(): Record<string, number> {
	return loadJson<Record<string, number>>(READ_FILE, {});
}

export function markRead(paneId: string, seq: number): void {
	const state = readState();
	if ((state[paneId] ?? -1) >= seq) return;
	state[paneId] = seq;
	saveJson(READ_FILE, state);
}

// --- done-watches: panes whose done transitions push, until unwatched ---

const WATCH_FILE = 'watch-done.json';

export function watchedPanes(): string[] {
	return loadJson<string[]>(WATCH_FILE, []);
}

export function setWatched(paneId: string, watched: boolean): void {
	const panes = new Set(watchedPanes());
	if (watched) panes.add(paneId);
	else panes.delete(paneId);
	saveJson(WATCH_FILE, [...panes]);
}

/** Persistent: every done transition notifies until the user unwatches. */
export function isWatched(paneId: string): boolean {
	return watchedPanes().includes(paneId);
}
