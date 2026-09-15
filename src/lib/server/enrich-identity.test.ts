import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Machine } from './herdr/machines';
import type { AgentSummary } from '$lib/types';

const fixture = vi.hoisted(() => ({
	machine: null as Machine | null,
	visible: '',
	delay: null as Promise<void> | null,
	reads: vi.fn(),
	keys: vi.fn()
}));
vi.mock('$lib/server/herdr', () => ({
	rawAgents: async () => [],
	rawAgent: async () => null,
	readVisible: async () => {
		fixture.reads();
		const visible = fixture.visible;
		await fixture.delay;
		return visible;
	},
	sendKeys: async (pane: string, keys: string[]) => {
		fixture.keys(pane, fixture.machine?.target, keys);
		fixture.visible = '';
	},
	promptAgent: vi.fn(),
	sendText: vi.fn()
}));
vi.mock('./herdr/connections', async (original) => ({
	...(await original<typeof import('./herdr/connections')>()),
	connectionFor: () => (fixture.machine?.enabled ? { machine: fixture.machine } : undefined)
}));
vi.mock('./herdr/branches', () => ({ branchesFor: async () => new Map() }));
import { enrichAgents, resetScreenCache } from './enrich';
import { POST } from '../../routes/api/agents/[pane]/answer/+server';

const summary = {
	paneId: 'remote~w:p',
	agent: 'claude',
	status: 'working',
	seq: 1,
	cwd: '/fixture'
} as AgentSummary;
function screen(subject: string) {
	return [
		'╭────────────────────────╮',
		'│ Bash command │',
		`│ ${subject} │`,
		'│ Proceed? │',
		'│ ❯ 1. Yes │',
		'│   2. No │',
		'╰────────────────────────╯'
	].join('\n');
}
beforeEach(() => {
	vi.useFakeTimers();
	resetScreenCache();
	fixture.machine = {
		id: 'remote',
		label: 'Fixture',
		target: 'old-host',
		session: 'default',
		enabled: true
	};
	fixture.visible = screen('old-host subject');
	fixture.delay = null;
	fixture.reads.mockClear();
	fixture.keys.mockClear();
});
afterEach(() => vi.useRealTimers());
it('reads new-host approvals immediately on warm retarget/session change and only answers what it displayed', async () => {
	expect((await enrichAgents([summary]))[0].picker?.context).toContain('old-host subject');
	for (const change of [{ target: 'new-host' }, { session: 'second' }]) {
		fixture.machine = { ...fixture.machine!, ...change };
		fixture.visible = screen(`${fixture.machine.target}/${fixture.machine.session} subject`);
		vi.advanceTimersByTime(100);
		const [next] = await enrichAgents([summary]);
		expect(next.picker?.context).toContain(
			`${fixture.machine.target}/${fixture.machine.session} subject`
		);
	}
	expect(fixture.reads).toHaveBeenCalledTimes(3);
	const [next] = await enrichAgents([summary]);
	const result = POST({
		params: { pane: next.paneId },
		request: new Request('http://fixture', {
			method: 'POST',
			body: JSON.stringify({ index: next.picker!.options[0].index })
		})
	} as Parameters<typeof POST>[0]);
	await vi.runAllTimersAsync();
	expect((await result).status).toBe(200);
	expect(fixture.keys).toHaveBeenCalledWith(summary.paneId, 'new-host', ['1']);
});
for (const revoke of ['disable', 'remove']) {
	it(`revokes warm actionable readings on ${revoke} and does not revive them on re-add`, async () => {
		await enrichAgents([summary]);
		const machine = fixture.machine!;
		fixture.machine = revoke === 'remove' ? null : { ...machine, enabled: false };
		expect(await enrichAgents([summary])).toEqual([]);
		fixture.machine = machine;
		fixture.visible = screen('new approval');
		expect((await enrichAgents([summary]))[0].picker?.context).toContain('new approval');
		expect(fixture.reads).toHaveBeenCalledTimes(2);
	});
}
it('neither publishes nor caches a delayed old-host read over a new-host approval', async () => {
	let release!: () => void;
	fixture.delay = new Promise((r) => {
		release = r;
	});
	const old = enrichAgents([summary]);
	await vi.waitFor(() => expect(fixture.reads).toHaveBeenCalledTimes(1));
	fixture.machine = { ...fixture.machine!, target: 'new-host' };
	fixture.visible = screen('new-host subject');
	fixture.delay = null;
	expect((await enrichAgents([summary]))[0].picker?.context).toContain('new-host subject');
	release();
	expect(await old).toEqual([]);
	// Reintroducing old identity must not revive a reading completed after its revocation.
	fixture.machine = { ...fixture.machine!, target: 'old-host' };
	fixture.visible = screen('returned-host new subject');
	expect((await enrichAgents([summary]))[0].picker?.context).toContain('returned-host new subject');
	expect(fixture.reads).toHaveBeenCalledTimes(3);
});
it('drops an in-flight read if its machine is removed before publication', async () => {
	let release!: () => void;
	fixture.delay = new Promise((r) => {
		release = r;
	});
	const old = enrichAgents([summary]);
	await vi.waitFor(() => expect(fixture.reads).toHaveBeenCalledTimes(1));
	const machine = fixture.machine;
	fixture.machine = null;
	release();
	expect(await old).toEqual([]);
	fixture.machine = machine;
	fixture.delay = null;
	fixture.visible = screen('re-added subject');
	expect((await enrichAgents([summary]))[0].picker?.context).toContain('re-added subject');
	expect(fixture.reads).toHaveBeenCalledTimes(2);
});
