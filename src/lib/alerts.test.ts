import { describe, expect, it } from 'vitest';
import { alertsFor, snapshot } from './alerts';
import type { AgentStatus } from './types';

const agent = (paneId: string, status: AgentStatus) => ({ paneId, status });

describe('alertsFor', () => {
	it('says nothing on the first snapshot, however many are waiting', () => {
		// The list arrives whole over SSE. Without this, opening the app with
		// four blocked agents would fire four chimes at once for nothing new.
		const now = [agent('w1:p1', 'blocked'), agent('w1:p2', 'done')];
		expect(alertsFor(new Map(), now, 'all')).toEqual([]);
	});

	it('fires when an agent starts needing you', () => {
		const before = snapshot([agent('w1:p1', 'working')]);
		expect(alertsFor(before, [agent('w1:p1', 'blocked')], 'attention')).toEqual(['attention']);
	});

	it('does not fire again while it stays blocked', () => {
		const before = snapshot([agent('w1:p1', 'blocked')]);
		expect(alertsFor(before, [agent('w1:p1', 'blocked')], 'all')).toEqual([]);
	});

	it('keeps done quiet unless asked for everything', () => {
		const before = snapshot([agent('w1:p1', 'working')]);
		expect(alertsFor(before, [agent('w1:p1', 'done')], 'attention')).toEqual([]);
		expect(alertsFor(before, [agent('w1:p1', 'done')], 'all')).toEqual(['done']);
	});

	it('says nothing at all when off, including for blocked', () => {
		const before = snapshot([agent('w1:p1', 'working')]);
		expect(alertsFor(before, [agent('w1:p1', 'blocked')], 'off')).toEqual([]);
	});

	it('treats a pane that has just appeared as new, not as a change', () => {
		// A pane opened elsewhere arrives mid-session; its first status is not
		// a transition and must not sound.
		const before = snapshot([agent('w1:p1', 'idle')]);
		expect(alertsFor(before, [agent('w1:p1', 'idle'), agent('w9:p9', 'blocked')], 'all')).toEqual(
			[]
		);
	});

	it('reports every agent that changed', () => {
		const before = snapshot([agent('a', 'working'), agent('b', 'working')]);
		const now = [agent('a', 'blocked'), agent('b', 'done')];
		expect(alertsFor(before, now, 'all')).toEqual(['attention', 'done']);
	});
});
