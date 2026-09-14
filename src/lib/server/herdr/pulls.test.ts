import { describe, expect, it } from 'vitest';
import { latestRuns, parsePull, rollup } from './pulls';

describe('rollup', () => {
	it('is nothing at all when there are no checks', () => {
		expect(rollup([])).toBe('none');
	});

	it('is passing when everything that ran, passed', () => {
		expect(rollup([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe('passing');
	});

	/**
	 * A skipped job is one that correctly decided it had nothing to do. Calling
	 * that red would make every path-filtered workflow look broken.
	 */
	it('does not count skipped or neutral as a failure', () => {
		expect(
			rollup([
				{ status: 'COMPLETED', conclusion: 'SKIPPED' },
				{ status: 'COMPLETED', conclusion: 'NEUTRAL' },
				{ status: 'COMPLETED', conclusion: 'SUCCESS' }
			])
		).toBe('passing');
	});

	it('is pending while anything is still running', () => {
		expect(
			rollup([
				{ status: 'COMPLETED', conclusion: 'SUCCESS' },
				{ status: 'IN_PROGRESS' },
				{ status: 'QUEUED' }
			])
		).toBe('pending');
	});

	/** One red job among nine running is the part worth acting on. */
	it('reports a failure even while the rest are still going', () => {
		expect(
			rollup([{ status: 'IN_PROGRESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }])
		).toBe('failing');
	});

	it('counts a cancelled or timed-out run as a failure', () => {
		expect(rollup([{ status: 'COMPLETED', conclusion: 'CANCELLED' }])).toBe('failing');
		expect(rollup([{ status: 'COMPLETED', conclusion: 'TIMED_OUT' }])).toBe('failing');
	});

	/**
	 * The older commit-status API, which is what most third-party CI posts. It
	 * has no `status` and no `conclusion`, only a `state` — reading just the
	 * Actions shape would call all of it "no checks".
	 */
	it('understands a plain commit status as well as a check run', () => {
		expect(rollup([{ state: 'SUCCESS' }])).toBe('passing');
		expect(rollup([{ state: 'FAILURE' }])).toBe('failing');
		expect(rollup([{ state: 'PENDING' }])).toBe('pending');
	});

	/**
	 * Taken from `gh pr view 33 --json statusCheckRollup` on this repository:
	 * a push cancelled the first `CI / gate` run and a second one passed. The
	 * cancelled run is history, not the check's verdict.
	 */
	it('judges each check by its latest run, not a run it superseded', () => {
		const cancelled = {
			__typename: 'CheckRun',
			completedAt: '2026-09-14T09:43:21Z',
			conclusion: 'CANCELLED',
			name: 'gate',
			startedAt: '2026-09-14T09:43:21Z',
			status: 'COMPLETED',
			workflowName: 'CI'
		};
		const passed = {
			__typename: 'CheckRun',
			completedAt: '2026-09-14T09:44:56Z',
			conclusion: 'SUCCESS',
			name: 'gate',
			startedAt: '2026-09-14T09:43:25Z',
			status: 'COMPLETED',
			workflowName: 'CI'
		};
		expect(rollup([cancelled, passed])).toBe('passing');
		// Order in the list is not what decides it; the timestamps are.
		expect(rollup([passed, cancelled])).toBe('passing');
	});

	it('still fails when the latest run is the cancelled one', () => {
		expect(
			rollup([
				{
					name: 'gate',
					workflowName: 'CI',
					startedAt: '2026-09-14T09:00:00Z',
					conclusion: 'SUCCESS'
				},
				{
					name: 'gate',
					workflowName: 'CI',
					startedAt: '2026-09-14T10:00:00Z',
					conclusion: 'CANCELLED'
				}
			])
		).toBe('failing');
	});

	/** Two workflows can each have a job called `gate`; they are different checks. */
	it('keeps same-named jobs from different workflows apart', () => {
		expect(
			rollup([
				{
					name: 'gate',
					workflowName: 'CI',
					startedAt: '2026-09-14T09:00:00Z',
					conclusion: 'FAILURE'
				},
				{
					name: 'gate',
					workflowName: 'Deploy',
					startedAt: '2026-09-14T10:00:00Z',
					conclusion: 'SUCCESS'
				}
			])
		).toBe('failing');
	});

	/** GitHub writes an unset timestamp as year 1, which must not outrank a real one. */
	it('falls back to completedAt, and treats the year-one placeholder as unset', () => {
		expect(
			rollup([
				{
					name: 'gate',
					workflowName: 'CI',
					completedAt: '2026-09-14T09:00:00Z',
					conclusion: 'CANCELLED'
				},
				{
					name: 'gate',
					workflowName: 'CI',
					completedAt: '2026-09-14T10:00:00Z',
					conclusion: 'SUCCESS'
				}
			])
		).toBe('passing');
		expect(
			latestRuns([
				{ name: 'gate', startedAt: '2026-09-14T09:00:00Z', conclusion: 'SUCCESS' },
				{ name: 'gate', startedAt: '0001-01-01T00:00:00Z', conclusion: 'CANCELLED' }
			])
		).toEqual([{ name: 'gate', startedAt: '2026-09-14T09:00:00Z', conclusion: 'SUCCESS' }]);
	});

	it('never merges entries that carry no name to match on', () => {
		expect(latestRuns([{ state: 'SUCCESS' }, { state: 'FAILURE' }])).toHaveLength(2);
		expect(rollup([{ state: 'SUCCESS' }, { state: 'FAILURE' }])).toBe('failing');
	});

	/** A verdict nobody has taught it yet must not read as green. */
	it('never calls something it does not recognise a pass', () => {
		expect(rollup([{ status: 'COMPLETED', conclusion: 'SOMETHING_NEW' }])).toBe('pending');
	});
});

describe('parsePull', () => {
	it('reads the fields the header needs', () => {
		const pull = parsePull(
			JSON.stringify({
				number: 945,
				state: 'OPEN',
				url: 'https://github.com/o/r/pull/945',
				isDraft: false,
				statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }]
			})
		);
		expect(pull).toEqual({
			number: 945,
			state: 'OPEN',
			url: 'https://github.com/o/r/pull/945',
			checks: 'passing',
			draft: false
		});
	});

	/** gh sends null when the head commit has no checks, not an empty array. */
	it('copes with a null rollup', () => {
		expect(parsePull(JSON.stringify({ number: 1, statusCheckRollup: null }))?.checks).toBe('none');
	});

	it('is nothing for empty output, junk, or an object with no number', () => {
		expect(parsePull('')).toBe(null);
		expect(parsePull('no pull requests found')).toBe(null);
		expect(parsePull(JSON.stringify({ state: 'OPEN' }))).toBe(null);
	});
});
