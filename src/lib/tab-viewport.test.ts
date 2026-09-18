import { describe, expect, it } from 'vitest';
import type { SplitNode } from './types';
import { projectActivePaneGeometry, quantiseViewport } from './tab-viewport';

const phone = { cols: 45, rows: 30, cellWidthPx: 8, cellHeightPx: 16 };

function pane(paneId: string): SplitNode {
	return { kind: 'pane', paneId };
}

function split(
	vertical: boolean,
	ratio: number,
	first: SplitNode,
	second: SplitNode,
	path: boolean[] = []
): SplitNode {
	return { kind: 'split', vertical, ratio, first, second, path };
}

describe('quantiseViewport', () => {
	it('uses whole terminal cells', () => {
		expect(quantiseViewport(1000, 500, 8, 16)).toEqual({
			cols: 125,
			rows: 31,
			cellWidthPx: 8,
			cellHeightPx: 16
		});
	});

	it('clamps dimensions to the Herdr contract', () => {
		expect(quantiseViewport(1, 1, 8, 16)).toEqual({
			cols: 10,
			rows: 3,
			cellWidthPx: 8,
			cellHeightPx: 16
		});
		expect(quantiseViewport(100_000, 100_000, 8, 16)?.cols).toBe(1000);
		expect(quantiseViewport(100_000, 100_000, 8, 16)?.rows).toBe(500);
	});

	it('refuses unmeasurable boxes', () => {
		expect(quantiseViewport(0, 500, 8, 16)).toBeNull();
		expect(quantiseViewport(1000, 500, 0, 16)).toBeNull();
	});
});

describe('projectActivePaneGeometry', () => {
	it('leaves a single pane at the phone grid', () => {
		expect(projectActivePaneGeometry(phone, pane('active'), 'active')).toEqual(phone);
	});

	it('expands a side split so the selected pane keeps the phone columns', () => {
		const tree = split(false, 0.5, pane('other'), pane('active'));
		expect(projectActivePaneGeometry(phone, tree, 'active')).toEqual({
			...phone,
			cols: 94,
			rows: 32
		});
	});

	it('inverts each split on the path to a nested selected pane', () => {
		const tree = split(
			false,
			0.4,
			pane('left'),
			split(true, 0.5, pane('top'), pane('active'), [true]),
			[]
		);
		expect(projectActivePaneGeometry(phone, tree, 'active')).toEqual({
			...phone,
			cols: 78,
			rows: 64
		});
	});

	it('does not project an inconsistent tree', () => {
		const tree = split(false, 0.5, pane('one'), pane('two'));
		expect(projectActivePaneGeometry(phone, tree, 'missing')).toEqual(phone);
	});
});
