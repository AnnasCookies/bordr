import { describe, expect, it } from 'vitest';
import { collapseHome, flatOrder, partitionAgents, rollupCounts, sortAgents } from './grouping';
import type { AgentStatus, AgentSummary } from './types';

function agent(over: Partial<AgentSummary> & { paneId: string }): AgentSummary {
	return {
		agent: 'claude',
		title: over.paneId,
		status: 'idle' as AgentStatus,
		cwd: '/home/dev/dev',
		seq: 1,
		workspaceId: 'w1',
		workspaceLabel: 'one',
		...over
	};
}

const FLEET: AgentSummary[] = [
	agent({ paneId: 'w1:p1', title: 'beta', status: 'working', workspaceId: 'w1', seq: 5 }),
	agent({ paneId: 'w1:p2', title: 'alpha', status: 'blocked', workspaceId: 'w1', seq: 9 }),
	agent({
		paneId: 'w2:p1',
		title: 'gamma',
		status: 'idle',
		agent: 'pi',
		workspaceId: 'w2',
		workspaceLabel: 'two',
		seq: 2
	}),
	agent({
		paneId: 'w2:p2',
		title: 'delta',
		status: 'done',
		agent: 'pi',
		workspaceId: 'w2',
		workspaceLabel: 'two',
		seq: 7
	})
];

describe('collapseHome', () => {
	it('collapses a home directory on either platform', () => {
		expect(collapseHome('/home/dev/Documents/Dev')).toBe('~/Documents/Dev');
		expect(collapseHome('/Users/dev/Documents')).toBe('~/Documents');
	});

	it('leaves a path outside home alone rather than mangling it', () => {
		expect(collapseHome('/srv/app')).toBe('/srv/app');
		expect(collapseHome('/home')).toBe('/home');
	});
});

describe('sortAgents', () => {
	it('orders by status then title by default', () => {
		expect(sortAgents(FLEET, 'status-title').map((a) => a.title)).toEqual([
			'alpha',
			'beta',
			'delta',
			'gamma'
		]);
	});

	it('orders by title alone when asked', () => {
		expect(sortAgents(FLEET, 'title').map((a) => a.title)).toEqual([
			'alpha',
			'beta',
			'delta',
			'gamma'
		]);
	});

	it('puts the most recently changed pane first for recent', () => {
		expect(sortAgents(FLEET, 'recent').map((a) => a.seq)).toEqual([9, 7, 5, 2]);
	});

	it('never mutates the array it was given', () => {
		const before = FLEET.map((a) => a.paneId);
		sortAgents(FLEET, 'recent');
		expect(FLEET.map((a) => a.paneId)).toEqual(before);
	});
});

describe('partitionAgents', () => {
	/** The whole point of the needs-you section: it must not double-render. */
	it('pins blocked agents and removes them from every group', () => {
		for (const mode of ['workspace', 'status', 'harness', 'none'] as const) {
			const { blocked, groups } = partitionAgents(FLEET, mode, 'status-title');
			expect(blocked.map((a) => a.paneId)).toEqual(['w1:p2']);
			const inGroups = groups.flatMap((g) => g.agents.map((a) => a.paneId));
			expect(inGroups).not.toContain('w1:p2');
			expect(new Set(inGroups).size).toBe(inGroups.length);
		}
	});

	it('groups by workspace in first-seen order, with the cwd on the right', () => {
		const { groups } = partitionAgents(FLEET, 'workspace', 'status-title');
		expect(groups.map((g) => g.left)).toEqual(['one', 'two']);
		expect(groups[0].right).toBe('~/dev');
	});

	it('groups by status in the documented order and omits empty statuses', () => {
		const { groups } = partitionAgents(FLEET, 'status', 'status-title');
		expect(groups.map((g) => g.left)).toEqual(['working · 1', 'done · 1', 'idle · 1']);
	});

	it('groups by harness alphabetically', () => {
		const { groups } = partitionAgents(FLEET, 'harness', 'status-title');
		expect(groups.map((g) => g.key)).toEqual(['claude', 'pi']);
	});

	it('returns one flat group with no header for none', () => {
		const { groups } = partitionAgents(FLEET, 'none', 'title');
		expect(groups).toHaveLength(1);
		expect(groups[0].left).toBe('');
		expect(groups[0].agents).toHaveLength(3);
	});

	it('produces no groups at all when only blocked agents exist', () => {
		const only = [FLEET[1]];
		expect(partitionAgents(only, 'none', 'title').groups).toEqual([]);
		expect(partitionAgents(only, 'workspace', 'title').groups).toEqual([]);
	});
});

describe('rollupCounts', () => {
	it('counts the four cells the grid shows, never unknown', () => {
		const withUnknown = [...FLEET, agent({ paneId: 'w3:p1', status: 'unknown' })];
		expect(rollupCounts(withUnknown)).toEqual([
			{ status: 'blocked', n: 1 },
			{ status: 'working', n: 1 },
			{ status: 'done', n: 1 },
			{ status: 'idle', n: 1 }
		]);
	});
});

describe('flatOrder', () => {
	/** Swiping between agents must follow what the list actually shows. */
	it('matches the rendered order, blocked first', () => {
		expect(flatOrder(FLEET, 'workspace', 'status-title')).toEqual([
			'w1:p2',
			'w1:p1',
			'w2:p2',
			'w2:p1'
		]);
	});

	it('changes with the sort, so swipe follows what you see', () => {
		expect(flatOrder(FLEET, 'none', 'recent')).toEqual(['w1:p2', 'w2:p2', 'w1:p1', 'w2:p1']);
	});
});
