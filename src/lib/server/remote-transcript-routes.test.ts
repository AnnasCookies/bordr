import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({
	visible: '',
	resolve: vi.fn(async () => '/local-only/fixture'),
	parse: vi.fn((text: string) =>
		text === 'remote-only'
			? [{ role: 'assistant', ask: { question: 'Remote?', options: ['REMOTE-ONLY-OPTION'] } }]
			: []
	),
	prompt: vi.fn(),
	keys: vi.fn(),
	remote: vi.fn(),
	adapter: vi.fn()
}));
vi.mock('#lib/server/herdr/index.js', () => ({
	rawAgent: async () => ({
		pane_id: 'remote~w1:p1',
		agent: 'codex',
		agent_session: { value: '/local-only/fixture' }
	}),
	rawPane: async () => null,
	toSummary: (raw: Record<string, unknown>) => ({ paneId: raw.pane_id, agent: raw.agent }),
	readVisible: async () => fixture.visible,
	promptAgent: fixture.prompt,
	sendKeys: fixture.keys,
	sendText: vi.fn(),
	getClient: vi.fn()
}));
vi.mock('#lib/server/herdr/connections.js', () => ({
	ensureConnection: async () => ({ machine: { id: 'remote' }, client: { sourceScope: 'fixture' } }),
	remoteTranscriptTail: fixture.remote
}));
vi.mock('#lib/server/transcript/index.js', () => ({ adapterFor: fixture.adapter }));
import { POST } from '../../routes/api/agents/[pane]/answer/+server';
import { GET } from '../../routes/api/agents/[pane]/subagents/[id]/+server';

const request = () =>
	new Request('http://fixture', {
		method: 'POST',
		body: JSON.stringify({ index: 1, scope: 'fixture' })
	});
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
	fixture.visible = '';
});

it('remote children reject local path collisions and scoped answer fallback reads the remote adapter', async () => {
	fixture.adapter.mockReturnValue({ resolve: fixture.resolve, parse: fixture.parse });
	await expect(
		GET({ params: { pane: 'remote~w1:p1', id: 'child' } } as Parameters<typeof GET>[0])
	).rejects.toMatchObject({ status: 404 });
	fixture.remote.mockResolvedValueOnce('remote-only').mockResolvedValue('');
	vi.useFakeTimers();
	const result = POST({ params: { pane: 'remote~w1:p1' }, request: request() } as Parameters<
		typeof POST
	>[0]);
	await vi.runAllTimersAsync();
	expect(await (await result).json()).toMatchObject({ outcome: 'accepted' });
	expect(fixture.prompt).toHaveBeenCalledWith('remote~w1:p1', 'REMOTE-ONLY-OPTION', 'fixture');
	expect(fixture.adapter).toHaveBeenCalledWith('codex', { remote: true });
	expect(fixture.resolve).not.toHaveBeenCalled();
	expect(fixture.remote).toHaveBeenCalledWith(
		{ id: 'remote' },
		'codex',
		'/local-only/fixture',
		1048576
	);
});

it('remote live-screen answers retain their source without transcript fallback', async () => {
	fixture.visible =
		'Pick a colour:\n❯ 1. Red\n  2. Green\nEnter to select · ↑/↓ to navigate · Esc to cancel';
	fixture.keys.mockImplementation(async () => {
		fixture.visible = '';
	});
	vi.useFakeTimers();
	const result = POST({ params: { pane: 'remote~w1:p1' }, request: request() } as Parameters<
		typeof POST
	>[0]);
	await vi.runAllTimersAsync();
	expect(await (await result).json()).toMatchObject({ outcome: 'accepted' });
	expect(fixture.keys).toHaveBeenCalledWith('remote~w1:p1', ['enter'], 'fixture');
	expect(fixture.remote).not.toHaveBeenCalled();
});

it('does not send a fallback confirmation into a new same-word approval subject', async () => {
	const screen = (subject: string) =>
		[
			'╭────────────────────────╮',
			'│ Bash command │',
			`│ ${subject} │`,
			'│ Proceed? │',
			'│ ❯ 1. Yes │',
			'│   2. No │',
			'╰────────────────────────╯'
		].join('\n');
	fixture.visible = screen('echo subject-A');
	fixture.keys.mockImplementation(async () => {
		fixture.visible = screen('echo subject-B');
	});
	vi.useFakeTimers();
	const result = POST({ params: { pane: 'remote~w1:p1' }, request: request() } as Parameters<
		typeof POST
	>[0]);
	await vi.runAllTimersAsync();
	expect(await (await result).json()).toMatchObject({ ok: true });
	expect(fixture.keys).toHaveBeenCalledTimes(1);
});
