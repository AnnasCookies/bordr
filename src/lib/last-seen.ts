/**
 * The last good copy of something, kept on this device.
 *
 * A phone on a bad link opens bordr to an empty sidebar until the first
 * response lands. Drawing what was there last time, then replacing it the
 * moment real data arrives, turns "nothing" into "slightly old". Never used
 * for anything you can act on without the live copy confirming it, and dropped
 * after `MAX_AGE_MS` so it cannot point at panes that went long ago.
 */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PREFIX = 'bordr:last:';

export function remember(key: string, value: unknown): void {
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value }));
	} catch {
		// Private window, blocked storage, or full: the live copy still works.
	}
}

export function recall<T>(key: string, now = Date.now()): T | null {
	try {
		const raw = localStorage.getItem(PREFIX + key);
		if (!raw) return null;
		const { at, value } = JSON.parse(raw) as { at?: number; value?: T };
		if (typeof at !== 'number' || now - at > MAX_AGE_MS || value === undefined) return null;
		return value;
	} catch {
		return null;
	}
}
