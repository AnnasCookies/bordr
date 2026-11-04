import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	CoreClient,
	claudeSessionId,
	openTranscript,
	remotePiSession,
	agentKind,
	agentStatus,
	placements,
	translateEvent,
	type CoreTerminal
} from './core';
import { piSessionByStart, sessionForProcess } from './core-session';
import { judgeCompatibility } from './compat';

const claude = (over: Partial<CoreTerminal> = {}): CoreTerminal => ({
	address: 't1',
	state: 'live',
	turn: 3,
	reported: true,
	cwd: '/home/u',
	title: 'Fix it',
	foreground: { pid: 0, name: 'claude', argv: ['claude'], cwd: '/home/u/repo' },
	status: { app: 'claude-code', state: 'working' },
	labels: {},
	...over
});

describe('agentKind', () => {
	it("maps core's claude-code onto bordr's claude", () => {
		expect(agentKind(claude())).toBe('claude');
	});
	it('falls back to the foreground program when nothing reported', () => {
		expect(
			agentKind(
				claude({
					status: null,
					reported: false,
					foreground: { name: 'codex', argv: ['/usr/bin/codex'] }
				})
			)
		).toBe('codex');
	});
	it('leaves a plain shell without a kind', () => {
		expect(
			agentKind(
				claude({ status: null, reported: false, foreground: { name: 'bash', argv: ['bash'] } })
			)
		).toBe('');
	});
});

describe('agentStatus', () => {
	it('treats error as needing a person', () => {
		expect(agentStatus(claude({ status: { app: 'claude-code', state: 'error' } }))).toBe('blocked');
	});
	it('is done until herdr.seen reaches the turn, then idle', () => {
		const done = { app: 'claude-code', state: 'done' };
		expect(agentStatus(claude({ status: done, turn: 4, labels: { 'herdr.seen': '3' } }))).toBe(
			'done'
		);
		expect(agentStatus(claude({ status: done, turn: 4, labels: { 'herdr.seen': '4' } }))).toBe(
			'idle'
		);
		// A missing label is not 0 (docs/labels.md): bordr's own read state decides.
		expect(agentStatus(claude({ status: done, turn: 0, labels: {} }))).toBe('done');
	});
});

describe('placements', () => {
	it('finds every terminal in a tab tree', () => {
		const map = placements([
			{
				id: 'sp1',
				tabs: [
					{
						id: 'tb1',
						root: {
							type: 'row',
							children: [
								{ content: { terminal: 't1' } },
								{ children: [{ content: { terminal: 't9' } }] }
							]
						}
					}
				]
			}
		]);
		expect(map.get('t1')).toEqual({ space: 'sp1', tab: 'tb1' });
		expect(map.get('t9')).toEqual({ space: 'sp1', tab: 'tb1' });
	});
});

describe('translateEvent', () => {
	it('turns a status note into the event push listens for', () => {
		expect(
			translateEvent('event', {
				seq: 1,
				type: 'status',
				terminal: 't7',
				data: { status: { state: 'blocked', kind: 'question' } }
			})
		).toEqual({
			event: 'pane.agent_status_changed',
			data: { type: 'pane.agent_status_changed', pane_id: 't7', agent_status: 'blocked' }
		});
	});
	it('skips other machines and heartbeats; a doc change is a layout change', () => {
		expect(translateEvent('event', { type: 'status', terminal: 'mac/t7', data: {} })).toBeNull();
		expect(translateEvent('heartbeat', { seq: 3 })).toBeNull();
		expect(translateEvent('event', { type: 'doc', data: { name: 'herdr-app' } })?.event).toBe(
			'layout.updated'
		);
	});
});

describe('judgeCompatibility on core', () => {
	it('accepts generation 1 and refuses another', () => {
		expect(judgeCompatibility({ backend: 'core', version: '0.1.17', generation: 1 })).toMatchObject(
			{
				level: 'ok',
				backend: 'core'
			}
		);
		expect(judgeCompatibility({ backend: 'core', generation: 2 }).level).toBe('incompatible');
	});
});

describe('sessionForProcess', () => {
	const dir = mkdtempSync(join(tmpdir(), 'bordr-core-session-'));
	const before = process.env.CLAUDE_CONFIG_DIR;
	afterAll(() => {
		process.env.CLAUDE_CONFIG_DIR = before;
		rmSync(dir, { recursive: true, force: true });
	});
	it("reads Claude Code's own pid record", () => {
		mkdirSync(join(dir, 'sessions'));
		writeFileSync(
			join(dir, 'sessions', '4242.json'),
			JSON.stringify({ pid: 4242, sessionId: 'abc-123' })
		);
		process.env.CLAUDE_CONFIG_DIR = dir;
		expect(sessionForProcess('claude', 4242)).toBe('abc-123');
		expect(sessionForProcess('claude', 4243)).toBe('');
	});
});

describe('piSessionByStart', () => {
	const root = mkdtempSync(join(tmpdir(), 'bordr-pi-'));
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const stamp = (ms: number) => new Date(ms).toISOString().replace(/:/g, '-').replace('.', '-');
	it('takes the first session pi stamped after the process started', () => {
		const dir = join(root, '--home-u-repo--');
		mkdirSync(dir);
		const soon = Date.now() + 60_000;
		for (const name of [
			`${stamp(Date.parse('2000-01-01T00:00:00Z'))}_old.jsonl`,
			`${stamp(soon + 5_000)}_later.jsonl`,
			`${stamp(soon)}_mine.jsonl`,
			`${stamp(soon)}_mine.jsonl.ctxc.jsonl`
		])
			writeFileSync(join(dir, name), '');
		expect(piSessionByStart(process.pid, root, '/home/u/repo')).toBe(
			join(dir, `${stamp(soon)}_mine.jsonl`)
		);
	});
});

describe('remote session text', () => {
	it("finds pi's session from its machine's home, folder and start clock", () => {
		// btime 1000 s + 500 ticks (5 s) = started at 1_005_000 ms since the epoch
		const started = new Date(1_005_000 + 2_000).toISOString().replace(/:/g, '-').replace('.', '-');
		const text = ['/home/u', '/home/u/repo', '1000 500', `${started}_mine.jsonl`, 'notes.txt'].join(
			'\n'
		);
		expect(remotePiSession(text)).toBe(
			`/home/u/.pi/agent/sessions/--home-u-repo--/${started}_mine.jsonl`
		);
		expect(remotePiSession('ls: cannot access')).toBe('');
	});

	it("reads Claude Code's pid record from another machine", () => {
		expect(claudeSessionId('{"pid":7,"sessionId":"abc"}')).toBe('abc');
		expect(claudeSessionId('cat: no such file')).toBe('');
	});
	it("picks the open transcript under that machine's own home", () => {
		const listing = [
			'/home/u',
			'/dev/pts/3',
			'/home/u/.codex/sessions/2026/11/04/rollout-x.jsonl',
			'/home/other/.codex/sessions/2026/11/04/rollout-y.jsonl'
		].join('\n');
		expect(openTranscript('codex', listing)).toBe(
			'/home/u/.codex/sessions/2026/11/04/rollout-x.jsonl'
		);
		expect(openTranscript('codex', '/dev/null')).toBe('');
		expect(openTranscript('claude', listing)).toBe('');
	});
});

describe('CoreClient over a socket', () => {
	const dir = mkdtempSync(join(tmpdir(), 'bordr-core-'));
	const path = join(dir, 'core.sock');
	let server: Server;
	const terminals: CoreTerminal[] = [
		claude({ address: 't1', labels: { where: 'bordr / work' } }),
		claude({
			address: 't2',
			status: null,
			reported: false,
			parent: 't1',
			foreground: { name: 'bash', argv: ['bash'] }
		}),
		claude({
			address: 't3',
			status: null,
			reported: false,
			foreground: { name: 'bash', argv: ['bash'] }
		}),
		claude({
			address: 'mac/t1',
			status: null,
			reported: false,
			foreground: { name: 'bash', argv: ['bash'] }
		}),
		claude({
			address: 'mac/t2',
			parent: 'mac/t1',
			foreground: { pid: 4242, name: 'claude', argv: ['claude'] }
		})
	];
	const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
	const doc = {
		spaces: [
			{
				id: 'sp1',
				name: '',
				folder: '/home/u/repo',
				tabs: [{ id: 'tb1', name: 'work', root: { content: { terminal: 't1' } } }]
			}
		]
	};

	beforeAll(async () => {
		server = createServer((socket) => {
			let buffer = '';
			socket.on('data', (chunk) => {
				buffer += chunk.toString();
				let nl: number;
				while ((nl = buffer.indexOf('\n')) !== -1) {
					const msg = JSON.parse(buffer.slice(0, nl));
					buffer = buffer.slice(nl + 1);
					calls.push({ method: msg.method, params: msg.params ?? {} });
					const result =
						msg.method === 'terminal.list'
							? { terminals }
							: msg.method === 'doc.get'
								? { value: doc, version: 1 }
								: msg.method === 'terminal.get'
									? { terminal: { address: msg.params.terminal, labels: { 'herdr.seen': '1' } } }
									: msg.method === 'terminal.label'
										? {}
										: msg.method === 'hello'
											? { generation: 1, version: '0.1.17', core: { name: 'box' } }
											: undefined;
					if (msg.method === 'terminal.send') {
						socket.write(
							JSON.stringify({
								jsonrpc: '2.0',
								id: msg.id,
								error: {
									code: -32000,
									message: 't1 is blocked (question)',
									data: { kind: 'blocked' }
								}
							}) + '\n'
						);
						continue;
					}
					socket.write(
						JSON.stringify(
							result
								? { jsonrpc: '2.0', id: msg.id, result }
								: {
										jsonrpc: '2.0',
										id: msg.id,
										error: { code: -32601, message: 'nope', data: { kind: 'unknown_method' } }
									}
						) + '\n'
					);
				}
			});
		});
		await new Promise<void>((resolve) => server.listen(path, resolve));
	});
	afterAll(() => {
		server.close();
		rmSync(dir, { recursive: true, force: true });
	});

	it('lists local agents with their space and tab, leaving other machines out', async () => {
		const { agents } = await new CoreClient(path).request<{ agents: Record<string, unknown>[] }>(
			'agent.list'
		);
		expect(agents).toHaveLength(1);
		expect(agents[0]).toMatchObject({
			pane_id: 't1',
			agent: 'claude',
			agent_status: 'working',
			workspace_id: 'sp1',
			tab_id: 'tb1',
			foreground_cwd: '/home/u/repo',
			state_change_seq: 3
		});
	});

	it('files a helper with its parent and an unplaced shell under Other', async () => {
		const client = new CoreClient(path);
		const { panes } = await client.request<{ panes: Record<string, unknown>[] }>('pane.list');
		expect(panes.map((p) => [p.pane_id, p.tab_id])).toEqual([
			['t1', 'tb1'],
			['t2', 'tb1'],
			['t3', 'core-other:1']
		]);
		const { workspaces } = await client.request<{ workspaces: Record<string, unknown>[] }>(
			'workspace.list'
		);
		// An unnamed space is called what herdr-app shows (`where`), not its stale folder.
		expect(workspaces.map((w) => w.label)).toEqual(['bordr', 'Other']);
	});

	it("turns core's refusal to type into a blocked agent into the TUI's agent_blocked", async () => {
		await expect(
			new CoreClient(path).request('agent.prompt', { target: 't1', text: 'yes' })
		).rejects.toMatchObject({ code: 'agent_blocked' });
	});

	it("serves another machine's terminals by their own ids, asking that machine's doc", async () => {
		calls.length = 0;
		const client = new CoreClient(path, undefined, 'scope', 'mac');
		const { panes } = await client.request<{ panes: Record<string, unknown>[] }>('pane.list');
		expect(panes.map((p) => [p.pane_id, p.agent])).toEqual([
			['t1', ''],
			['t2', 'claude']
		]);
		expect(calls.find((c) => c.method === 'doc.get')?.params).toMatchObject({ on: 'mac' });
		// The session is looked up on that machine, through core.
		expect(calls.some((c) => c.method === 'machine.exec' && c.params.on === 'mac')).toBe(true);
		calls.length = 0;
		await client.request('pane.send_keys', { pane_id: 't2', keys: ['enter'] }).catch(() => {});
		expect(calls[0]).toMatchObject({ method: 'terminal.keys', params: { terminal: 'mac/t2' } });
	});

	it("marks another machine's terminal seen on that machine, only ever raising it", async () => {
		const client = new CoreClient(path, undefined, 'scope', 'mac');
		calls.length = 0;
		await client.markSeen('t2', 1);
		expect(calls.some((c) => c.method === 'terminal.label')).toBe(false);
		await client.markSeen('t2', 4);
		expect(calls.find((c) => c.method === 'terminal.label')?.params).toEqual({
			terminal: 'mac/t2',
			labels: { 'herdr.seen': '4' }
		});
	});

	it('answers ping as core and refuses what core cannot do', async () => {
		const client = new CoreClient(path);
		expect(await client.request('ping')).toMatchObject({ backend: 'core', generation: 1 });
		await expect(client.request('pane.read', { pane_id: 'mac/t1' })).rejects.toThrow(/no terminal/);
		await expect(client.request('pane.split', { pane_id: 't1' })).rejects.toThrow(
			/not available on herdr-core/
		);
	});
});
