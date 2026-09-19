import { describe, expect, it } from 'vitest';
import type { WorkspaceNode } from '$lib/types';
import { paneAfterExit } from './pane-exit';

function workspaces(): WorkspaceNode[] {
	const pane = (paneId: string, tabId: string, workspaceId: string) => ({
		paneId,
		tabId,
		workspaceId,
		agent: '',
		hasAgent: false,
		status: 'shell',
		title: '',
		cwd: '/tmp',
		focused: false
	});
	return [
		{
			workspaceId: 'w1',
			machine: '',
			label: 'one',
			number: 1,
			focused: true,
			branch: '',
			ahead: 0,
			behind: 0,
			tabs: [
				{
					tabId: 'w1:t1',
					workspaceId: 'w1',
					label: '1',
					number: 1,
					focused: true,
					panes: [pane('w1:p2', 'w1:t1', 'w1')]
				}
			]
		},
		{
			workspaceId: 'w2',
			machine: '',
			label: 'two',
			number: 2,
			focused: false,
			branch: '',
			ahead: 0,
			behind: 0,
			tabs: [
				{
					tabId: 'w2:t1',
					workspaceId: 'w2',
					label: '1',
					number: 1,
					focused: false,
					panes: [pane('w2:p1', 'w2:t1', 'w2')]
				}
			]
		}
	];
}

describe('paneAfterExit', () => {
	it('stays in the same tab when a sibling survived', () => {
		expect(paneAfterExit(workspaces(), 'w1:p1', 'w1:t1')).toBe('w1:p2');
	});

	it('falls back to another tab or workspace', () => {
		expect(paneAfterExit(workspaces(), 'w1:p2', 'w1:t1')).toBe('w2:p1');
	});

	it('returns null when no pane survived', () => {
		expect(paneAfterExit([], 'w1:p1', 'w1:t1')).toBeNull();
	});
});
