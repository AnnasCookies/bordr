import { describe, expect, it } from 'vitest';
import { splitLayoutFingerprint } from './layout-fingerprint';
import type { AgentStatus, PaneNode, WorkspaceNode } from './types';

function pane(paneId: string, status: AgentStatus): PaneNode {
	return {
		paneId,
		tabId: 't1',
		workspaceId: 'w1',
		agent: paneId === 'p1' ? 'pi' : '',
		hasAgent: paneId === 'p1',
		status,
		title: paneId,
		cwd: `/${paneId}`,
		focused: paneId === 'p1'
	};
}

function tree(ratio = 0.6, status: AgentStatus = 'idle'): WorkspaceNode[] {
	return [
		{
			workspaceId: 'w1',
			machine: '',
			label: 'Workspace',
			number: 1,
			focused: true,
			branch: '',
			ahead: 0,
			behind: 0,
			tabs: [
				{
					tabId: 't1',
					workspaceId: 'w1',
					number: 1,
					label: 'Tab',
					focused: true,
					panes: [pane('p1', status), pane('p2', 'unknown')],
					layout: {
						zoomed: false,
						focusedPaneId: 'p1',
						tree: {
							kind: 'split',
							vertical: false,
							ratio,
							path: [],
							first: { kind: 'pane', paneId: 'p1' },
							second: { kind: 'pane', paneId: 'p2' }
						}
					}
				}
			]
		}
	];
}

describe('splitLayoutFingerprint', () => {
	it('ignores status churn that cannot change split geometry', () => {
		expect(splitLayoutFingerprint(tree(0.6, 'idle'))).toBe(
			splitLayoutFingerprint(tree(0.6, 'working'))
		);
	});

	it('changes for a moved divider or pane topology', () => {
		expect(splitLayoutFingerprint(tree(0.6))).not.toBe(splitLayoutFingerprint(tree(0.7)));
		const removed = tree();
		removed[0].tabs[0].panes.pop();
		expect(splitLayoutFingerprint(tree())).not.toBe(splitLayoutFingerprint(removed));
	});
});
