import { describe, expect, it } from 'vitest';
import { uniqueKeys } from './row-keys';

describe('uniqueKeys', () => {
	it('leaves keys that are already unique exactly as they were', () => {
		expect(uniqueKeys(['m1:user:hi', 'm2:assistant:Read:a.ts', 'm7'])).toEqual([
			'm1:user:hi',
			'm2:assistant:Read:a.ts',
			'm7'
		]);
	});

	it('numbers repeats in order, keeping the plain key on the first', () => {
		// Two parallel Reads of different files that are both `index.ts`,
		// written in the same millisecond, and then a duplicated entry.
		const same = 'm1700000000000:assistant:Read:index.ts';
		expect(uniqueKeys([same, same, same])).toEqual([same, `${same}#1`, `${same}#2`]);
	});

	it('numbers each repeated key on its own', () => {
		expect(uniqueKeys(['a', 'b', 'a', 'b', 'a'])).toEqual(['a', 'b', 'a#1', 'b#1', 'a#2']);
	});

	it('never lands a suffix on a key that is already in the list', () => {
		const keys = uniqueKeys(['a', 'a', 'a#1', 'a#1']);
		expect(keys).toEqual(['a', 'a#2', 'a#1', 'a#1#1']);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('keeps the numbers already given when a later repeat arrives', () => {
		const before = uniqueKeys(['x', 'k', 'k']);
		const after = uniqueKeys(['x', 'k', 'k', 'y', 'k']);
		expect(after.slice(0, 3)).toEqual(before);
		expect(after[4]).toBe('k#2');
	});
});
