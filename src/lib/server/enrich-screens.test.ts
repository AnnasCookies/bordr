import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSummary } from '$lib/types';

/**
 * Status consistency across harnesses: herdr flags Claude Code's prompts as
 * `blocked`, but pi asks its questions under `working`. bordr reads the
 * screen for every pane and lets a dialog decide.
 */
const herdr = vi.hoisted(() => ({
	screens: new Map<string, string>(),
	readVisible: vi.fn(async (paneId: string) => herdr.screens.get(paneId) ?? 'quiet\n'),
	rawAgents: vi.fn(async () => [] as Record<string, unknown>[])
}));
vi.mock('./herdr', () => herdr);
vi.mock('./transcript', () => ({ adapterFor: () => null }));

// pi's dialog as `agent.read --source visible` returned it live, 2026-09-07.
const PI_DIALOG = [
	' Which colour?',
	'❯ 1. Red',
	'  2. Green',
	'  3. Blue',
	' Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel'
].join('\n');

const agent = (paneId: string, status: AgentSummary['status'], seq = 1): AgentSummary => ({
	paneId,
	agent: 'pi',
	title: paneId,
	status,
	cwd: '/home/dev',
	seq,
	workspaceId: 'w1',
	workspaceLabel: 'w1'
});

async function load() {
	const mod = await import('./enrich');
	mod.resetScreenCache();
	return mod.enrichAgents;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-07T10:00:00Z'));
	herdr.screens.clear();
	herdr.readVisible.mockClear();
});

describe('enrichAgents: a dialog on screen counts as blocked', () => {
	it('promotes a working pi pane with a question on screen to blocked, with its picker', async () => {
		herdr.screens.set('pi:1', PI_DIALOG);
		const enrich = await load();
		const [row] = await enrich([agent('pi:1', 'working')]);
		expect(row.status).toBe('blocked');
		expect(row.picker?.options.map((o) => o.label)).toEqual(['Red', 'Green', 'Blue']);
	});

	it('leaves a working pane alone when its screen shows no dialog', async () => {
		const enrich = await load();
		const [row] = await enrich([agent('pi:1', 'working')]);
		expect(row.status).toBe('working');
		expect(row.picker).toBeNull();
	});

	it('does not re-read a chatty working pane inside the interval', async () => {
		const enrich = await load();
		await enrich([agent('pi:1', 'working', 1)]);
		await enrich([agent('pi:1', 'working', 2)]);
		await enrich([agent('pi:1', 'working', 3)]);
		expect(herdr.readVisible).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(2_100);
		await enrich([agent('pi:1', 'working', 4)]);
		expect(herdr.readVisible).toHaveBeenCalledTimes(2);
	});

	/** herdr's seq moves on state changes, not repaints; pi's dialog has neither. */
	it('re-reads an active pane on the interval even when its seq has not moved', async () => {
		const enrich = await load();
		await enrich([agent('pi:1', 'working', 5)]);
		vi.advanceTimersByTime(2_100);
		herdr.screens.set('pi:1', PI_DIALOG);
		const [row] = await enrich([agent('pi:1', 'working', 5)]);
		expect(herdr.readVisible).toHaveBeenCalledTimes(2);
		expect(row.status).toBe('blocked');
	});

	it('re-reads an idle pane on a state change at once, otherwise on the slow beat', async () => {
		const enrich = await load();
		await enrich([agent('pi:1', 'idle', 5)]);
		vi.advanceTimersByTime(2_100);
		await enrich([agent('pi:1', 'idle', 5)]);
		expect(herdr.readVisible).toHaveBeenCalledTimes(1);
		await enrich([agent('pi:1', 'idle', 6)]);
		expect(herdr.readVisible).toHaveBeenCalledTimes(2);
		// A slash-command menu opened on an idle pane arrives with no event
		// and no state change; the slow beat is what finds it.
		vi.advanceTimersByTime(4_000);
		await enrich([agent('pi:1', 'idle', 6)]);
		expect(herdr.readVisible).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(2_100);
		herdr.screens.set('pi:1', PI_DIALOG);
		const [row] = await enrich([agent('pi:1', 'idle', 6)]);
		expect(herdr.readVisible).toHaveBeenCalledTimes(3);
		expect(row.status).toBe('blocked');
	});

	it('always re-reads a pane herdr itself calls blocked', async () => {
		const enrich = await load();
		await enrich([agent('c:1', 'blocked')]);
		await enrich([agent('c:1', 'blocked')]);
		expect(herdr.readVisible).toHaveBeenCalledTimes(2);
	});

	it('clears the promotion once the dialog is gone, even if seq never moved', async () => {
		herdr.screens.set('pi:1', PI_DIALOG);
		const enrich = await load();
		expect((await enrich([agent('pi:1', 'working', 7)]))[0].status).toBe('blocked');

		herdr.screens.delete('pi:1');
		vi.advanceTimersByTime(2_100);
		const [row] = await enrich([agent('pi:1', 'working', 7)]);
		expect(row.status).toBe('working');
		expect(row.picker).toBeNull();
	});

	it('forgets panes that have gone', async () => {
		herdr.screens.set('pi:1', PI_DIALOG);
		const enrich = await load();
		await enrich([agent('pi:1', 'working')]);
		herdr.readVisible.mockClear();
		await enrich([agent('pi:2', 'working')]);
		// pi:1 dropped out of the list: its reading is discarded, so if it
		// returns it is read afresh rather than served a stale dialog.
		herdr.screens.delete('pi:1');
		vi.advanceTimersByTime(2_100);
		const rows = await enrich([agent('pi:1', 'working'), agent('pi:2', 'working')]);
		expect(rows.map((r) => r.status)).toEqual(['working', 'working']);
	});
});
