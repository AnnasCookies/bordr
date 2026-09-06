/**
 * Only inert navigation keys — a phone keypad must never become a channel
 * for control sequences or text injection (that is what prompt is for).
 */
const ALLOWED = new Set(['up', 'down', 'left', 'right', 'enter', 'esc', 'tab', 'space']);
const MAX_BATCH = 20;

export function validateKeys(keys: unknown): string[] {
	if (!Array.isArray(keys) || keys.length === 0) throw new Error('keys must be a non-empty array');
	if (keys.length > MAX_BATCH) throw new Error(`at most ${MAX_BATCH} keys per request`);
	for (const key of keys) {
		if (typeof key !== 'string' || !ALLOWED.has(key)) {
			throw new Error(`key not allowed: ${String(key)}`);
		}
	}
	return keys as string[];
}
