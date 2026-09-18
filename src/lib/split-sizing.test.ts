import { describe, expect, it } from 'vitest';
import { splitBranchStyles, splitContains } from './split-sizing';
import type { SplitNode } from './types';

const tree: SplitNode = {
	kind: 'split',
	vertical: false,
	ratio: 0.7,
	path: [],
	first: { kind: 'pane', paneId: 'p1' },
	second: {
		kind: 'split',
		vertical: true,
		ratio: 0.5,
		path: [true],
		first: { kind: 'pane', paneId: 'p2' },
		second: { kind: 'pane', paneId: 'p3' }
	}
};

describe('splitContains', () => {
	it('finds panes through a nested split', () => {
		expect(splitContains(tree, 'p1')).toBe(true);
		expect(splitContains(tree, 'p3')).toBe(true);
		expect(splitContains(tree, 'missing')).toBe(false);
	});
});

describe('splitBranchStyles', () => {
	it('lets a horizontal sibling fit its content while the active pane takes the spare width', () => {
		expect(splitBranchStyles(false, 0.7, true, false, false)).toEqual({
			first: 'flex: 1 1 0',
			second: 'flex: 0 1 14rem; max-width: 35%',
			auto: true
		});
	});

	it('fits a vertical sibling by height whichever side is active', () => {
		expect(splitBranchStyles(true, 0.3, false, true, false)).toEqual({
			first: 'flex: 0 0 clamp(7rem, 18%, 35%); max-height: 35%',
			second: 'flex: 1 1 0',
			auto: true
		});
	});

	it('keeps Herdr ratios for all-inactive branches and after a manual resize', () => {
		const ratio = {
			first: 'flex: 0.7 1 0',
			second: 'flex: 0.30000000000000004 1 0',
			auto: false
		};
		expect(splitBranchStyles(false, 0.7, false, false, false)).toEqual(ratio);
		expect(splitBranchStyles(false, 0.7, true, false, true)).toEqual(ratio);
	});
});
