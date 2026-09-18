import { describe, expect, it } from 'vitest';
import { quantiseViewport } from './tab-viewport';

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
