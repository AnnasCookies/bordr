import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePane } from './herdr/address';
import { connectionKey } from './herdr/connections';
import { listMachines } from './herdr/machines';

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

type ReadMarker = { seq: number; scope: string };

function readMarkers(): Record<string, number | ReadMarker> {
	const value = loadJson<unknown>(READ_FILE, {});
	return Object.assign(
		Object.create(null),
		value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
	) as Record<string, number | ReadMarker>;
}

export function readScopeFor(paneId: string): string | null {
	const { machineId } = parsePane(paneId);
	if (!machineId) return '';
	const machine = listMachines().find((m) => m.id === machineId && m.enabled);
	return machine ? connectionKey(machine) : null;
}

function readSeq(
	marker: number | ReadMarker | undefined,
	scope: string | null
): number | undefined {
	// Legacy remote markers have no target identity: never carry them to another host.
	const seq =
		typeof marker === 'number'
			? scope === ''
				? marker
				: undefined
			: marker?.scope === scope && scope !== null
				? marker.seq
				: undefined;
	return typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0 ? seq : undefined;
}

export function readState(): Record<string, number> {
	const read: Record<string, number> = Object.create(null);
	for (const [paneId, marker] of Object.entries(readMarkers())) {
		const seq = readSeq(marker, readScopeFor(paneId));
		if (seq !== undefined) read[paneId] = seq;
	}
	return read;
}

export function markRead(paneId: string, seq: number, expectedScope?: string): void {
	if (!paneId || !Number.isSafeInteger(seq) || seq < 0) throw new Error('invalid read marker');
	const scope = readScopeFor(paneId);
	if (scope === null) throw new Error('read marker machine is not permitted');
	if ((scope !== '' || expectedScope !== undefined) && expectedScope !== scope)
		throw new Error('read marker scope changed');
	const state = readMarkers();
	const previous = readSeq(state[paneId], scope);
	if (previous !== undefined && previous >= seq) return;
	state[paneId] = { seq, scope };
	saveJson(READ_FILE, state);
}

/**
 * herdr's `done` means finished and not yet looked at: its terminal turns
 * the tick back to idle once the pane has been on screen. herdr only does
 * that for its own client, so bordr does the same from its read state — a
 * `done` pane read at or past the seq it finished on shows as idle.
 */
export function seenStatus<S extends string>(
	status: S,
	seq: number,
	readSeq: number | undefined
): S | 'idle' {
	return status === 'done' && readSeq !== undefined && readSeq >= seq ? 'idle' : status;
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
