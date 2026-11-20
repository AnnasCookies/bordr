import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerLanded, settleAfterAnswer, waitUntil } from './index';
import { CoreClient } from './core';

const remote = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('./machines', () => ({ listMachines: () => [], setCoreMachines: () => {} }));
vi.mock('./connections', () => ({
	ensureConnection: async () => ({ error: null, client: remote.client })
}));

describe('waitUntil', () => {
	it('returns as soon as the check says done, not at the deadline', async () => {
		let calls = 0;
		const started = Date.now();
		expect(await waitUntil(async () => ++calls >= 2, 2_000, 10)).toBe(true);
		expect(calls).toBe(2);
		expect(Date.now() - started).toBeLessThan(500);
	});

	it('gives up at the deadline, and a throwing check counts as not done', async () => {
		const started = Date.now();
		expect(
			await waitUntil(
				async () => {
					throw new Error('herdr hiccup');
				},
				100,
				10
			)
		).toBe(false);
		expect(Date.now() - started).toBeGreaterThanOrEqual(100);
	});

	it('does not wait for a check that is still in flight at the deadline', async () => {
		// A stalled socket answers after its own ten-second timeout, not the budget.
		const stalled = vi.fn(() => new Promise<boolean>(() => {}));
		const started = Date.now();
		expect(await waitUntil(stalled, 100, 10)).toBe(false);
		expect(Date.now() - started).toBeLessThan(1_000);
		// And it does not start a second check beside the one still in flight.
		expect(stalled).toHaveBeenCalledTimes(1);
	});

	it('asks nothing once the time is up', async () => {
		// Each check takes 40 ms of a 100 ms budget, so the third poll would land
		// past the deadline: it is not made, where it used to be made and abandoned.
		const slow = vi.fn(async () => {
			await new Promise((r) => setTimeout(r, 40));
			return false;
		});
		expect(await waitUntil(slow, 100, 10)).toBe(false);
		expect(slow.mock.calls.length).toBeLessThanOrEqual(2);
	});
});

describe('answerLanded', () => {
	/**
	 * A check fed one status and one look at the screen per poll, on a clock the
	 * test moves. Each poll is followed by a turn of the event loop, as the real
	 * waiter's sleep gives it, so a status asked for in one poll is known by the next.
	 */
	const polls = (statuses: Array<boolean | Error>, screens: Array<boolean | Error> | null) => {
		const clock = { at: 0 };
		const check = answerLanded(
			async () => {
				const status = statuses.shift() ?? false;
				if (status instanceof Error) throw status;
				return status;
			},
			screens
				? async () => {
						const moved = screens.shift() ?? false;
						if (moved instanceof Error) throw moved;
						return moved;
					}
				: undefined,
			500,
			() => clock.at
		);
		const poll = async () => {
			const landed = await check();
			await new Promise((r) => setTimeout(r, 0));
			return landed;
		};
		const run = async (times: number) => {
			const answers: boolean[] = [];
			for (let at = 0; at < times; at++) answers.push(await poll());
			return answers;
		};
		return { poll, run, clock };
	};
	const failed = new Error('could not be read');

	it('ends on the screen alone once it has moved on twice running', async () => {
		// pi asks while herdr still says `working`: there is no status to go by.
		expect(await polls([false, false, false], [false, true, true]).run(3)).toEqual([
			false,
			false,
			true
		]);
	});

	it('does not take one half-drawn read for the question going away', async () => {
		expect(await polls([true, true, true, true], [true, false, true, false]).run(4)).toEqual([
			false,
			false,
			false,
			false
		]);
	});

	it('needs only one look once herdr has said blocked and then stopped saying it', async () => {
		expect(await polls([true, false, false], [false, false, true]).run(3)).toEqual([
			false,
			false,
			true
		]);
	});

	it('does not end on the status while the screen still shows the question', async () => {
		// The status can flip before the redraw, and a pane missing from herdr's
		// list reads the same as one that is no longer blocked.
		expect(await polls([true, false, false, false], [false, false, false, false]).run(4)).toEqual([
			false,
			false,
			false,
			false
		]);
	});

	it('does not end on the status when the screen could not be read either', async () => {
		expect(await polls([true, false, false], [false, failed, failed]).run(3)).toEqual([
			false,
			false,
			false
		]);
	});

	it('does not end just because herdr never said blocked', async () => {
		const { poll, clock } = polls([false, false, false], [false, false, false]);
		expect(await poll()).toBe(false);
		clock.at = 499;
		expect(await poll()).toBe(false);
		// Nothing to wait on but the clock, so it gets the old flat half second.
		clock.at = 500;
		expect(await poll()).toBe(true);
	});

	it('takes a screen it could not read as no signal, and as a break in the run', async () => {
		expect(await polls([true, true, true, true], [true, failed, true, true]).run(4)).toEqual([
			false,
			false,
			false,
			true
		]);
		// Unreadable throughout, and never flagged: the flat wait still ends it.
		const { poll, clock } = polls([false, false], [failed, failed]);
		expect(await poll()).toBe(false);
		clock.at = 500;
		expect(await poll()).toBe(true);
	});

	it('goes by the screen when herdr cannot say whether the pane is blocked', async () => {
		expect(await polls([failed, failed], [true, true]).run(2)).toEqual([false, true]);
	});

	it('keeps reading the screen while a status call is stalled', async () => {
		// Through the real waiter: one status call that never returns, and a
		// screen that moves on at its second poll.
		const stalled = vi.fn(() => new Promise<boolean>(() => {}));
		const screens = [false, true, true];
		const started = Date.now();
		expect(
			await waitUntil(
				answerLanded(stalled, async () => screens.shift() ?? true),
				2_000,
				10
			)
		).toBe(true);
		expect(Date.now() - started).toBeLessThan(1_000);
		// And it is not asked again while the first call is still out.
		expect(stalled).toHaveBeenCalledTimes(1);
	});

	it('keeps to the status and the flat wait when there is no screen to read', async () => {
		const unflagged = polls([false, false], null);
		expect(await unflagged.poll()).toBe(false);
		unflagged.clock.at = 500;
		expect(await unflagged.poll()).toBe(true);
		expect(await polls([true, false], null).run(2)).toEqual([false, true]);
	});
});

describe('settleAfterAnswer', () => {
	beforeEach(() => {
		remote.client = null;
	});

	it("asks a linked machine's core about the one terminal, never for its whole list", async () => {
		const client = new CoreClient('/nonexistent/core.sock', undefined, 'scope', 'mac');
		const isBlocked = vi.spyOn(client, 'isBlocked').mockResolvedValue(true);
		const request = vi.spyOn(client, 'request');
		remote.client = client;
		await settleAfterAnswer('mac~t7', 40, 'scope', async () => false, 10);
		expect(isBlocked).toHaveBeenCalledWith('t7');
		expect(request).not.toHaveBeenCalled();
	});

	it("reads a TUI pane's status from its own herdr, under the answer's scope", async () => {
		const request = vi.fn(async () => ({
			agents: [{ pane_id: 'w1:p1', agent_status: 'blocked' }]
		}));
		remote.client = { sourceScope: 'scope', request };
		const screens = [false, true, true];
		await settleAfterAnswer('remote~w1:p1', 500, 'scope', async () => screens.shift()!, 10);
		expect(request).toHaveBeenCalledWith('agent.list');
		expect(screens).toEqual([]);
	});

	it('asks nothing of a target whose scope has changed since the answer', async () => {
		const request = vi.fn();
		remote.client = { sourceScope: 'replacement', request };
		// The route's own screen read checks the scope too, and refuses the same way.
		const moved = vi.fn(async (): Promise<boolean> => {
			throw new Error('the pane target changed');
		});
		const started = Date.now();
		await settleAfterAnswer('remote~w1:p1', 60, 'original', moved, 10);
		expect(Date.now() - started).toBeGreaterThanOrEqual(60);
		expect(request).not.toHaveBeenCalled();
	});
});
