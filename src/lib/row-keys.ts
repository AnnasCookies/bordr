/**
 * Transcript row keys, made unique.
 *
 * A row is keyed on what it is — its timestamp, speaker and first tool or
 * line of text — so it keeps its identity while the window grows backwards.
 * Two records can still say the same thing at the same millisecond: parallel
 * Reads of two files that are both called `index.ts`, or an entry the harness
 * wrote twice. Svelte refuses a keyed `each` with a repeated key and stops
 * rendering the list, so one such pair took the whole transcript down.
 *
 * Repeats take `#1`, `#2` … in the order they appear, and the first keeps its
 * plain key. Number the whole transcript, not a visible slice, so new records
 * at the end leave earlier numbers alone; only a pair split by the server's
 * byte window could renumber, and that costs a remount, not a crash.
 *
 * A suffix never lands on a key that is already in the list, in case a line
 * of text happens to end in `#1`.
 */
export function uniqueKeys(keys: readonly string[]): string[] {
	const taken = new Set(keys);
	const seen = new Set<string>();
	return keys.map((key) => {
		if (!seen.has(key)) {
			seen.add(key);
			return key;
		}
		let suffix = 1;
		while (taken.has(`${key}#${suffix}`) || seen.has(`${key}#${suffix}`)) suffix++;
		const unique = `${key}#${suffix}`;
		seen.add(unique);
		return unique;
	});
}
