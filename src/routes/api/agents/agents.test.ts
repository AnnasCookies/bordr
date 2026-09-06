import { describe, expect, it } from 'vitest';
import { sortAgents, toSummary } from '$lib/server/herdr';

const RAW = {
	pane_id: 'w2:p1',
	agent: 'claude',
	agent_status: 'working',
	cwd: '/home/user',
	terminal_title_stripped: 'Testing telegram',
	agent_session: { value: 'abc-123' },
	state_change_seq: 7
};

describe('toSummary', () => {
	it('maps herdr fields onto the client shape', () => {
		expect(toSummary(RAW)).toEqual({
			paneId: 'w2:p1',
			agent: 'claude',
			title: 'Testing telegram',
			status: 'working',
			cwd: '/home/user',
			seq: 7,
			workspaceId: '',
			workspaceLabel: ''
		});
	});

	it('falls back to unknown for an unrecognised status', () => {
		expect(toSummary({ ...RAW, agent_status: 'wat' }).status).toBe('unknown');
	});

	it('prefers a user-named workspace over the harness terminal title', () => {
		const labels = new Map([['w2', 'bordr']]);
		expect(toSummary({ ...RAW, workspace_id: 'w2' }, labels).title).toBe('bordr');
	});

	it('ignores default numeric workspace labels', () => {
		const labels = new Map([['w2', '2']]);
		expect(toSummary({ ...RAW, workspace_id: 'w2' }, labels).title).toBe('Testing telegram');
	});

	it('prefers an explicit herdr agent name above everything', () => {
		const labels = new Map([['w2', 'bordr']]);
		expect(toSummary({ ...RAW, workspace_id: 'w2', name: 'spike' }, labels).title).toBe('spike');
	});
});

describe('sortAgents', () => {
	it('pins blocked agents to the top, then working', () => {
		const order = sortAgents([
			{ ...toSummary(RAW), paneId: 'a', status: 'idle' },
			{ ...toSummary(RAW), paneId: 'b', status: 'blocked' },
			{ ...toSummary(RAW), paneId: 'c', status: 'working' },
			{ ...toSummary(RAW), paneId: 'd', status: 'done' }
		]).map((a) => a.paneId);
		expect(order).toEqual(['b', 'c', 'd', 'a']);
	});
});
