import { describe, expect, it } from 'vitest';
import {
	agentTitle,
	collapseHome,
	flatOrder,
	partitionAgents,
	rollupCounts,
	sortAgents
} from './grouping';
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

describe('agentTitle', () => {
	it('keeps a title the harness wrote', () => {
		expect(agentTitle('ctxc #11403', 'bordr', 'w1:p1')).toBe('ctxc #11403');
	});

	/**
	 * The case this exists for: an idle agy under the shell's own title, which
	 * read as a stray terminal in a list of agents.
	 */
	it('falls back to the workspace when the shell title is still up', () => {
		expect(agentTitle('tony@tm-work:~', 'win-vm-omarchy', 'wJ:p1')).toBe('win-vm-omarchy');
		expect(agentTitle('~', 'bordr', 'w3:p1')).toBe('bordr');
		expect(agentTitle('~/repos/it-work', 'it-work', 'w6:p1')).toBe('it-work');
		expect(agentTitle('/var/log', 'logs', 'w2:p1')).toBe('logs');
		expect(agentTitle('', 'e2e', 'wM:p1')).toBe('e2e');
	});

	it('does not mistake real work for a shell prompt', () => {
		expect(agentTitle('Fix the @mentions parser', 'bordr', 'w1:p1')).toBe(
			'Fix the @mentions parser'
		);
		expect(agentTitle('user@host is unreachable', 'ops', 'w1:p1')).toBe('user@host is unreachable');
	});

	/**
	 * An agent started in home sits in a workspace called `~`, so falling back
	 * to the workspace just repeats the problem — say what the row is instead.
	 */
	it('names the harness when the workspace is shell-shaped too', () => {
		expect(agentTitle('~', '~', 'wB:p1', 'opencode')).toBe('opencode');
	});

	it('has the pane id to fall back on when there is nothing else', () => {
		expect(agentTitle('~', '', 'w9:p2')).toBe('w9:p2');
	});
});
