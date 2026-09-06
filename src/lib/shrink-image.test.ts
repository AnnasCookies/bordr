import { describe, expect, it } from 'vitest';
import { MAX_EDGE, planShrink } from './shrink-image';

describe('planShrink', () => {
	it('scales a 12-megapixel camera photo down to the long edge and re-encodes as JPEG', () => {
		const plan = planShrink({ type: 'image/jpeg', size: 4_800_000 }, 4032, 3024);
		expect(plan.skip).toBe(false);
		expect(plan.type).toBe('image/jpeg');
		expect(Math.round(4032 * plan.scale)).toBe(MAX_EDGE);
	});

	it('keeps a screenshot as PNG so text stays crisp, scaled only when it is taller than the edge', () => {
		const tall = planShrink({ type: 'image/png', size: 1_200_000 }, 1344, 2992);
		expect(tall.type).toBe('image/png');
		expect(Math.round(2992 * tall.scale)).toBe(MAX_EDGE);
		const small = planShrink({ type: 'image/png', size: 200_000 }, 800, 600);
		expect(small.skip).toBe(true);
	});

	it('leaves a small JPEG alone but re-encodes a large one that already fits the edge', () => {
		expect(planShrink({ type: 'image/jpeg', size: 300_000 }, 1600, 1200).skip).toBe(true);
		expect(planShrink({ type: 'image/jpeg', size: 2_500_000 }, 2000, 1500).skip).toBe(false);
	});

	it('never upscales', () => {
		expect(planShrink({ type: 'image/jpeg', size: 3_000_000 }, 1000, 800).scale).toBe(1);
	});
});
