import { describe, expect, it } from 'vitest';
import { parseTodoPlan, todoPlanFromDetails } from './todo-plan';

const DETAILS = {
	op: 'done',
	phases: [
		{
			name: 'Setup',
			tasks: [
				{ content: 'Read config', status: 'completed' },
				{ content: 'Remove old probe', status: 'abandoned' }
			]
		},
		{
			name: 'OMP status',
			tasks: [
				{ content: 'Trace status rows', status: 'in_progress' },
				{ content: 'Check remote service', status: 'blocked', blocker: 'server offline' },
				{ content: 'Render card', status: 'pending' }
			]
		}
	],
	storage: 'session'
};

describe('todoPlanFromDetails', () => {
	it('uses canonical OMP phases, states and blocker text', () => {
		expect(todoPlanFromDetails(DETAILS)).toEqual({
			completed: 1,
			abandoned: 1,
			closed: 2,
			total: 5,
			open: 2,
			blocked: 1,
			activePhase: 'OMP status',
			activePhaseIndex: 2,
			phaseCount: 2,
			phases: [
				{
					name: 'Setup',
					items: [
						{ content: 'Read config', status: 'completed' },
						{ content: 'Remove old probe', status: 'abandoned' }
					]
				},
				{
					name: 'OMP status',
					items: [
						{ content: 'Trace status rows', status: 'in_progress' },
						{
							content: 'Check remote service',
							status: 'blocked',
							note: 'server offline'
						},
						{ content: 'Render card', status: 'pending' }
					]
				}
			]
		});
	});

	it('rejects malformed details rather than showing a partial plan', () => {
		expect(
			todoPlanFromDetails({
				phases: [{ name: 'Bad', tasks: [{ content: 'Task', status: 'lost' }] }]
			})
		).toBeNull();
	});
});

describe('parseTodoPlan legacy fallback', () => {
	it('accepts annotated active phases, blocked totals and dropped tasks', () => {
		const snapshot = `Overall: 2/4 done, 1 open, 1 blocked.
Active phase 2/3 "OMP status" (4/6) — earliest phase with open tasks…
  Setup:
    - [X] Read config
    - [ ] Remove old probe (dropped)
  OMP status:
    - [ ] Trace status rows (in progress)
    - [ ] Check remote service (blocked: server offline)`;

		expect(parseTodoPlan(snapshot)).toMatchObject({
			completed: 1,
			abandoned: 1,
			closed: 2,
			total: 4,
			open: 1,
			blocked: 1,
			activePhase: 'OMP status',
			activePhaseIndex: 2,
			phaseCount: 3
		});
		expect(parseTodoPlan(snapshot)?.phases[0].items[1].status).toBe('abandoned');
		expect(parseTodoPlan(snapshot)?.phases[1].items[1]).toEqual({
			content: 'Check remote service',
			status: 'blocked',
			note: 'server offline'
		});
	});

	it('rejects ordinary tool output', () => {
		expect(parseTodoPlan('command completed')).toBeNull();
	});
});
