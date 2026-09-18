import { describe, expect, it } from 'vitest';
import { parseTodoPlan, PiTodoTracker, todoPlanFromDetails } from './todo-plan';

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

describe('PiTodoTracker', () => {
	it('replays create and update calls into a complete plan', () => {
		const tracker = new PiTodoTracker();
		expect(
			tracker.apply({ action: 'create', subject: 'Trace flicker' }, 'Created #9: Trace flicker')
		).toMatchObject({ total: 1, closed: 0, open: 1 });
		expect(
			tracker.apply(
				{ action: 'update', id: 9, status: 'completed' },
				'Updated #9 (in_progress → completed)'
			)
		).toMatchObject({ total: 1, closed: 1, open: 0 });
	});

	it('seeds from Pi list output and strips only the active spinner label', () => {
		const tracker = new PiTodoTracker();
		const plan = tracker.apply(
			{ action: 'list' },
			'[completed] #9 Trace flicker\n[in_progress] #10 Wrap previews (wrapping previews)\n[pending] #11 Test (desktop)'
		);
		expect(plan).toMatchObject({ total: 3, closed: 1, open: 2 });
		expect(plan?.phases[0].items).toEqual([
			{ content: 'Trace flicker', status: 'completed' },
			{ content: 'Wrap previews', status: 'in_progress' },
			{ content: 'Test (desktop)', status: 'pending' }
		]);
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
