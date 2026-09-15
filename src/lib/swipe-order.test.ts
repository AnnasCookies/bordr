import { describe, expect, it } from 'vitest';
import { afterClose } from './after-close';
import { currentTabPanes, swipeSequence } from './swipe-order';

const tree = (ids: string[]) => [{ tabs: [{ panes: ids.map((paneId) => ({ paneId })) }] }];
const ORDER = ['a1', 'b1', 'c1', 'd1'];

describe('currentTabPanes', () => {
	// Tab one is a split holding p1 and p2; tab two holds p3 alone.
	const WORKSPACES = [
		{
			tabs: [
				{ panes: [{ paneId: 'w1:p1' }, { paneId: 'w1:p2' }] },
				{ panes: [{ paneId: 'w1:p3' }] }
			]
		},
		{ tabs: [{ panes: [{ paneId: 'w2:p1' }] }] }
	];

	/** Not one pane per tab: every pane of the ONE tab holding the pane you read. */
	it('is every pane of a split tab, from either half', () => {
		expect(currentTabPanes(WORKSPACES, 'w1:p1')).toEqual(['w1:p1', 'w1:p2']);
		expect(currentTabPanes(WORKSPACES, 'w1:p2')).toEqual(['w1:p1', 'w1:p2']);
	});

	it('is the one pane of an unsplit tab, in whichever workspace holds it', () => {
		expect(currentTabPanes(WORKSPACES, 'w1:p3')).toEqual(['w1:p3']);
		expect(currentTabPanes(WORKSPACES, 'w2:p1')).toEqual(['w2:p1']);
	});

	/** Ids are opaque: a machine-prefixed id is a different pane, not a match. */
	it('compares ids whole', () => {
		expect(currentTabPanes(WORKSPACES, 'p1')).toEqual([]);
		expect(currentTabPanes([{ tabs: [{ panes: [{ paneId: 'box:w1:p1' }] }] }], 'w1:p1')).toEqual(
			[]
		);
	});

	/**
	 * The bug this exists for. The tab bar reported one pane per tab, so
	 * closing the split tab while reading p1 counted p1 and p3 as gone and
	 * landed on p2 — which had just been closed with it.
	 */
	it('sends a closed split tab somewhere outside it', () => {
		const all = ['w1:p1', 'w1:p2', 'w1:p3', 'w2:p1'];
		const siblings = currentTabPanes(WORKSPACES, 'w1:p1');
		expect(afterClose({ scope: 'tab', current: 'w1:p1', siblings, all })).toBe('w1:p3');
		expect(afterClose({ scope: 'pane', current: 'w1:p1', siblings, all })).toBe('w1:p2');
	});

	/** Reading the half that is not the tab's link target still walks the split. */
	it('lets a swipe walk the split from its second pane', () => {
		const order = ['w1:p1', 'w1:p3', 'w2:p1'];
		expect(swipeSequence(order, WORKSPACES)).toEqual(['w1:p1', 'w1:p2', 'w1:p3', 'w2:p1']);
	});
});

describe('swipeSequence', () => {
	it('is the plain agent order when the tab holds one pane', () => {
		expect(swipeSequence(ORDER, tree(['b1']))).toEqual(ORDER);
		expect(swipeSequence(ORDER, tree([]))).toEqual(ORDER);
	});

	/**
	 * The bug this exists for: a tab with siblings replaced the list entirely,
	 * so from inside it the rest of the fleet could not be swiped to at all.
	 */
	it('keeps the rest of the fleet reachable', () => {
		const out = swipeSequence(ORDER, tree(['b1', 'b2']));
		expect(out).toContain('a1');
		expect(out).toContain('d1');
	});

	/** The tab's panes together, where the tab sits in the list. */
	it('weaves the tab in at its own place', () => {
		expect(swipeSequence(ORDER, tree(['b1', 'b2']))).toEqual(['a1', 'b1', 'b2', 'c1', 'd1']);
	});

	it('keeps the tab in tab order, not list order', () => {
		expect(swipeSequence(ORDER, tree(['b2', 'b1']))).toEqual(['a1', 'b2', 'b1', 'c1', 'd1']);
	});

	/** Two panes of one tab sitting apart in the list are gathered together. */
	it('gathers panes the list had scattered', () => {
		expect(swipeSequence(['a1', 'b1', 'c1', 'b2'], tree(['b1', 'b2']))).toEqual([
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
		expect(swipeSequence(ORDER, tree(['b1', 'shell']))).toEqual(['a1', 'b1', 'shell', 'c1', 'd1']);
	});

	it('keeps shell-only tabs at a stable position after the fleet', () => {
		expect(swipeSequence(ORDER, tree(['s1', 's2']))).toEqual(['a1', 'b1', 'c1', 'd1', 's1', 's2']);
	});

	/** Every pane appears once, whatever the inputs. */
	it('never repeats a pane', () => {
		const out = swipeSequence(ORDER, tree(['b1', 'c1', 'shell']));
		expect(new Set(out).size).toBe(out.length);
		expect(out).toEqual(['a1', 'b1', 'c1', 'shell', 'd1']);
	});
});

it('tours interleaved split tabs repeatedly without a current-pane-dependent trap', () => {
	const workspaces = [
		{ tabs: [{ panes: [{ paneId: 'a' }, { paneId: 'c' }] }, { panes: [{ paneId: 'b' }] }] }
	];
	let current = 'a';
	const visited: string[] = [];
	for (let i = 0; i < 6; i++) {
		const ring = swipeSequence(['a', 'b', 'c'], workspaces);
		visited.push(current);
		current = ring[(ring.indexOf(current) + 1) % ring.length];
	}
	expect(visited).toEqual(['a', 'c', 'b', 'a', 'c', 'b']);
});
