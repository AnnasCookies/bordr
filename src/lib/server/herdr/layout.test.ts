import { describe, expect, it } from 'vitest';
import { treeFrom, type RawLayout } from './layout';
import type { SplitNode } from '$lib/types';

const AREA = { x: 0, y: 0, width: 198, height: 115 };

function layout(partial: Partial<RawLayout>): RawLayout {
	return {
		tab_id: 'w1:t1',
		zoomed: false,
		area: AREA,
		focused_pane_id: 'w1:p1',
		panes: [],
		splits: [],
		...partial
	};
}

/** Every pane in the tree, in the order the tree lays them out. */
function leaves(node: SplitNode): string[] {
	return node.kind === 'pane' ? [node.paneId] : [...leaves(node.first), ...leaves(node.second)];
}

describe('treeFrom', () => {
	it('gives a lone pane no split at all', () => {
		const { tree } = treeFrom(
			layout({ panes: [{ pane_id: 'w1:p1', focused: true, rect: AREA }] }),
			''
		);
		expect(tree).toEqual({ kind: 'pane', paneId: 'w1:p1' });
	});

	// The real shape herdr reported for a side-by-side tab.
	it('reads a root split, its direction and its ratio', () => {
		const { tree } = treeFrom(
			layout({
				panes: [
					{ pane_id: 'w2:p1', focused: true, rect: { x: 0, y: 0, width: 99, height: 115 } },
					{ pane_id: 'w2:p3', focused: false, rect: { x: 99, y: 0, width: 99, height: 115 } }
				],
				splits: [{ id: 'split_0_root', direction: 'right', ratio: 0.5, rect: AREA }]
			}),
			''
		);
		if (tree.kind !== 'split') throw new Error('expected a split');
		expect(tree.vertical).toBe(false);
		expect(tree.ratio).toBe(0.5);
		expect(tree.path).toEqual([]);
		expect(leaves(tree)).toEqual(['w2:p1', 'w2:p3']);
	});

	it('treats a down split as stacked', () => {
		const { tree } = treeFrom(
			layout({
				panes: [
					{ pane_id: 'w9:p1', focused: true, rect: { x: 0, y: 0, width: 198, height: 88 } },
					{ pane_id: 'w9:p2', focused: false, rect: { x: 0, y: 88, width: 198, height: 27 } }
				],
				splits: [{ id: 'split_0_root', direction: 'down', ratio: 0.76521736, rect: AREA }]
			}),
			''
		);
		if (tree.kind !== 'split') throw new Error('expected a split');
		expect(tree.vertical).toBe(true);
		expect(leaves(tree)).toEqual(['w9:p1', 'w9:p2']);
	});

	/**
	 * The nested case, measured off a real three-pane tab: a root split to the
	 * right, and the left half split again downwards. The inner split's path
	 * must be [false] — the first half — because that is what herdr's
	 * layout.set_split_ratio walks, and getting it wrong resizes the wrong
	 * divider rather than failing.
	 */
	it('gives a nested split the path down to it', () => {
		const { tree } = treeFrom(
			layout({
				panes: [
					{ pane_id: 'w1:p1', focused: true, rect: { x: 0, y: 0, width: 99, height: 58 } },
					{ pane_id: 'w1:pK', focused: false, rect: { x: 0, y: 58, width: 99, height: 57 } },
					{ pane_id: 'w1:pJ', focused: false, rect: { x: 99, y: 0, width: 99, height: 115 } }
				],
				splits: [
					{ id: 'split_0_root', direction: 'right', ratio: 0.5, rect: AREA },
					{
						id: 'split_1_0',
						direction: 'down',
						ratio: 0.5,
						rect: { x: 0, y: 0, width: 99, height: 115 }
					}
				]
			}),
			''
		);
		if (tree.kind !== 'split') throw new Error('expected a split');
		expect(tree.first.kind).toBe('split');
		if (tree.first.kind !== 'split') throw new Error('expected a nested split');
		expect(tree.first.path).toEqual([false]);
		expect(tree.first.vertical).toBe(true);
		expect(tree.second).toEqual({ kind: 'pane', paneId: 'w1:pJ' });
		expect(leaves(tree)).toEqual(['w1:p1', 'w1:pK', 'w1:pJ']);
	});

	/**
	 * An odd area with a ratio that does not land on a cell boundary. Deriving
	 * a child region from the rounded cut rather than from the panes that fell
	 * either side of it put the region a cell out, matched no nested split, and
	 * quietly lost the branch.
	 */
	it('finds a nested split even when the cut does not divide evenly', () => {
		const area = { x: 0, y: 0, width: 201, height: 117 };
		const { tree } = treeFrom(
			layout({
				area,
				panes: [
					{ pane_id: 'p1', focused: true, rect: { x: 0, y: 0, width: 101, height: 59 } },
					{ pane_id: 'p2', focused: false, rect: { x: 0, y: 59, width: 101, height: 58 } },
					{ pane_id: 'p3', focused: false, rect: { x: 101, y: 0, width: 100, height: 117 } }
				],
				splits: [
					{ id: 'split_0_root', direction: 'right', ratio: 0.503, rect: area },
					{
						id: 'split_1_0',
						direction: 'down',
						ratio: 0.504,
						rect: { x: 0, y: 0, width: 101, height: 117 }
					}
				]
			}),
			''
		);
		if (tree.kind !== 'split') throw new Error('expected a split');
		expect(tree.first.kind).toBe('split');
		if (tree.first.kind !== 'split') throw new Error('expected a nested split');
		expect(tree.first.path).toEqual([false]);
		expect(leaves(tree)).toEqual(['p1', 'p2', 'p3']);
	});

	it('addresses a remote machine pane through its machine', () => {
		const { tree, focusedPaneId } = treeFrom(
			layout({ panes: [{ pane_id: 'w1:p1', focused: true, rect: AREA }] }),
			'tm-dev'
		);
		expect(tree).toEqual({ kind: 'pane', paneId: 'tm-dev~w1:p1' });
		expect(focusedPaneId).toBe('tm-dev~w1:p1');
	});
});
