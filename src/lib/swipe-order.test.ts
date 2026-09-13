import { describe, expect, it } from 'vitest';
import { swipeSequence } from './swipe-order';

const ORDER = ['a1', 'b1', 'c1', 'd1'];

describe('swipeSequence', () => {
	it('is the plain agent order when the tab holds one pane', () => {
		expect(swipeSequence(ORDER, ['b1'], 'b1')).toEqual(ORDER);
		expect(swipeSequence(ORDER, [], 'b1')).toEqual(ORDER);
	});

	/**
	 * The bug this exists for: a tab with siblings replaced the list entirely,
	 * so from inside it the rest of the fleet could not be swiped to at all.
	 */
	it('keeps the rest of the fleet reachable', () => {
		const out = swipeSequence(ORDER, ['b1', 'b2'], 'b1');
		expect(out).toContain('a1');
		expect(out).toContain('d1');
	});

	/** The tab's panes together, where the tab sits in the list. */
	it('weaves the tab in at its own place', () => {
		expect(swipeSequence(ORDER, ['b1', 'b2'], 'b1')).toEqual(['a1', 'b1', 'b2', 'c1', 'd1']);
	});

	it('keeps the tab in tab order, not list order', () => {
		expect(swipeSequence(ORDER, ['b2', 'b1'], 'b1')).toEqual(['a1', 'b2', 'b1', 'c1', 'd1']);
	});

	/** Two panes of one tab sitting apart in the list are gathered together. */
	it('gathers panes the list had scattered', () => {
		expect(swipeSequence(['a1', 'b1', 'c1', 'b2'], ['b1', 'b2'], 'b1')).toEqual([
			'a1',
			'b1',
			'b2',
			'c1'
		]);
	});

	/**
	 * A shell is a pane and not an agent, so it is in the tab and not in the
	 * list. Skipping it would mean swiping past the thing sitting next to you.
	 */
	it('carries panes the agent list never had', () => {
		expect(swipeSequence(ORDER, ['b1', 'shell'], 'b1')).toEqual(['a1', 'b1', 'shell', 'c1', 'd1']);
	});

	it('puts a tab of nothing but shells at the front', () => {
		expect(swipeSequence(ORDER, ['s1', 's2'], 's1')).toEqual(['s1', 's2', 'a1', 'b1', 'c1', 'd1']);
	});

	/** Every pane appears once, whatever the inputs. */
	it('never repeats a pane', () => {
		const out = swipeSequence(ORDER, ['b1', 'c1', 'shell'], 'b1');
		expect(new Set(out).size).toBe(out.length);
		expect(out).toEqual(['a1', 'b1', 'c1', 'shell', 'd1']);
	});
});
