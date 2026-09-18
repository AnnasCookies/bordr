import { describe, expect, it } from 'vitest';
import {
	decideSwipe,
	dragTarget,
	inEdgeZone,
	neighbourPane,
	swipeNavigationDelta,
	SWIPE
} from './swipe';

const WIDE = 402;

describe('dragTarget', () => {
	/**
	 * The preview card must name the pane letting go lands on. Three agents,
	 * because with two the ring makes next and previous the same pane and the
	 * card was right by accident.
	 */
	it('previews the pane the finished gesture commits to', () => {
		const ring = ['a', 'b', 'c'];
		for (const dx of [120, -120]) {
			const direction = decideSwipe(dx, 0, 200, WIDE);
			if (!direction) throw new Error(`a ${dx}px drag should be a swipe`);
			expect(dragTarget(ring, 'b', dx)).toBe(neighbourPane(ring, 'b', direction));
		}
		expect(dragTarget(ring, 'b', 120)).toBe('c');
		expect(dragTarget(ring, 'b', -120)).toBe('a');
	});

	it('has nothing to preview when there is nowhere to go', () => {
		expect(dragTarget(['a'], 'a', 80)).toBeNull();
		expect(dragTarget(['a', 'b'], 'zz', 80)).toBeNull();
	});
});

describe('swipeNavigationDelta', () => {
	it('keeps the default mapping and reverses only when asked', () => {
		expect(swipeNavigationDelta(120, false)).toBe(120);
		expect(swipeNavigationDelta(-120, false)).toBe(-120);
		expect(swipeNavigationDelta(120, true)).toBe(-120);
		expect(swipeNavigationDelta(-120, true)).toBe(120);
	});
});

describe('decideSwipe', () => {
	it('reads a clear rightward drag as the next agent', () => {
		expect(decideSwipe(120, 10, 200, WIDE)).toBe('next');
	});

	it('reads a clear leftward drag as the previous agent', () => {
		expect(decideSwipe(-120, 10, 200, WIDE)).toBe('previous');
	});

	it('ignores a short drag', () => {
		expect(decideSwipe(SWIPE.distance - 1, 0, 200, WIDE)).toBeNull();
	});

	/** Scrolling a long transcript must never navigate away from it. */
	it('ignores a mostly-vertical drag however far it travelled', () => {
		expect(decideSwipe(80, 200, 200, WIDE)).toBeNull();
		expect(decideSwipe(80, 39, 200, WIDE)).toBe('next');
		expect(decideSwipe(80, 41, 200, WIDE)).toBeNull();
	});

	/**
	 * BOTH edges belong to the phone's back gesture. Guarding only the left one
	 * meant a back-swipe from the right edge cycled agents and went back at the
	 * same time.
	 */
	it('leaves both screen edges to the system back gesture', () => {
		expect(decideSwipe(150, 0, 5, WIDE)).toBeNull();
		expect(decideSwipe(-150, 0, WIDE - 5, WIDE)).toBeNull();
		expect(decideSwipe(150, 0, SWIPE.edge + 1, WIDE)).toBe('next');
		expect(decideSwipe(-150, 0, WIDE - SWIPE.edge - 1, WIDE)).toBe('previous');
	});
});

describe('neighbourPane', () => {
	const order = ['a', 'b', 'c'];

	it('steps forward and back through the list order', () => {
		expect(neighbourPane(order, 'a', 'next')).toBe('b');
		expect(neighbourPane(order, 'b', 'previous')).toBe('a');
	});

	/** It is a cycle: the screen edges are the way back to the list. */
	it('wraps around both ends', () => {
		expect(neighbourPane(order, 'c', 'next')).toBe('a');
		expect(neighbourPane(order, 'a', 'previous')).toBe('c');
	});

	/** Left undoes right from anywhere, including across the wrap. */
	it('next and previous are inverses at every position', () => {
		const ring = ['a', 'b', 'c', 'd'];
		for (const pane of ring) {
			const forward = neighbourPane(ring, pane, 'next') as string;
			expect(neighbourPane(ring, forward, 'previous')).toBe(pane);
			const back = neighbourPane(ring, pane, 'previous') as string;
			expect(neighbourPane(ring, back, 'next')).toBe(pane);
		}
	});

	it('returns nothing when there is nowhere to cycle to', () => {
		expect(neighbourPane(order, 'zz', 'next')).toBeNull();
		expect(neighbourPane([], 'a', 'next')).toBeNull();
		expect(neighbourPane(['only'], 'only', 'next')).toBeNull();
	});
});

describe('inEdgeZone', () => {
	/**
	 * Both edges belong to the phone's own back and forward gestures. This is
	 * checked when the gesture STARTS as well as when it ends: refusing only at
	 * the end meant the transcript had already been dragged across the screen
	 * while the system navigated underneath it.
	 */
	it('claims neither edge', () => {
		expect(inEdgeZone(0, 430)).toBe(true);
		expect(inEdgeZone(32, 430)).toBe(true);
		expect(inEdgeZone(430, 430)).toBe(true);
		expect(inEdgeZone(398, 430)).toBe(true);
	});

	it('leaves the middle alone', () => {
		expect(inEdgeZone(33, 430)).toBe(false);
		expect(inEdgeZone(215, 430)).toBe(false);
		expect(inEdgeZone(397, 430)).toBe(false);
	});

	/** A narrow screen is nearly all edge, and that is the honest answer. */
	it('copes with a screen narrower than both zones', () => {
		expect(inEdgeZone(30, 50)).toBe(true);
	});
});
