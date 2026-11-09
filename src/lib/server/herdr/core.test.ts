import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import {
	appendFileSync,
	chmodSync,
	closeSync,
	mkdtempSync,
	mkdirSync,
	openSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	CoreClient,
	claudeRecordPid,
	claudeRemoteScript,
	claudeSessionId,
	openTranscript,
	remotePiSession,
	agentKind,
	agentStatus,
	placements,
	sendOnceSettled,
	translateEvent,
	viaLoginShell,
	type CoreTerminal
} from './core';
import { HerdrRequestError } from './client';
import {
	agyConversation,
	agyLogConversation,
	piSessionByStart,
	sessionForProcess,
	sessionFromLinks
} from './core-session';
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
	it('knows an npm harness that reports nothing by the script node runs', () => {
		// As hc 0.1.15 showed copilot: no status, foreground name `node-MainThread`.
		const copilot = claude({
			status: null,
			reported: false,
			foreground: { name: 'node-MainThread', argv: ['node', '/home/u/.bun/bin/copilot'] }
		});
		expect(agentKind(copilot)).toBe('copilot');
		const script = claude({
			status: null,
			reported: false,
			foreground: { name: 'node-MainThread', argv: ['node', '/home/u/app/server.js'] }
		});
		expect(agentKind(script)).toBe('');
	});
	it("maps the app words agy and grok report (hc 0.1.18) onto bordr's names", () => {
		const node = { name: 'node-MainThread', argv: ['node', '/opt/x/index.js'] };
		expect(
			agentKind(claude({ status: { app: 'antigravity', state: 'idle' }, foreground: node }))
		).toBe('agy');
		expect(
			agentKind(claude({ status: { app: 'grok-build', state: 'idle' }, foreground: node }))
		).toBe('grok');
	});
});

describe('sendOnceSettled', () => {
	const starting = () =>
		new HerdrRequestError(
			'unavailable',
			'terminal.send: t1r is still starting: its output has not settled'
		);
	const noSleep = async () => {};

	it('sends again while the program is still starting, then succeeds', async () => {
		let calls = 0;
		const send = async () => {
			if (++calls < 3) throw starting();
			return 'sent';
		};
		expect(await sendOnceSettled(send, noSleep)).toBe('sent');
		expect(calls).toBe(3);
	});
	it('never retries any other refusal, even another `unavailable`', async () => {
		let calls = 0;
		const other = new HerdrRequestError('unavailable', 'terminal.send: input is pending recovery');
		await expect(
			sendOnceSettled(async () => {
				calls++;
				throw other;
			}, noSleep)
		).rejects.toBe(other);
		expect(calls).toBe(1);
		// The words alone are not enough: only core's own `unavailable` says nothing was typed.
		const lookalike = new HerdrRequestError('protocol_error', 'x is still starting');
		await expect(
			sendOnceSettled(async () => {
				calls++;
				throw lookalike;
			}, noSleep)
		).rejects.toBe(lookalike);
		expect(calls).toBe(2);
	});
	it('gives up after its last delay', async () => {
		let calls = 0;
		await expect(
			sendOnceSettled(
				async () => {
					calls++;
					throw starting();
				},
				noSleep,
				[1, 1]
			)
		).rejects.toThrow(/still starting/);
		expect(calls).toBe(3);
	});
});

describe('viaLoginShell', () => {
	const tricky = ['printf', '<%s>', '--no-daemon', 'two words', "it's", '$HOME', '*'];
	const home = mkdtempSync(join(tmpdir(), 'bordr-shell-'));
	afterAll(() => rmSync(home, { recursive: true, force: true }));

	for (const name of ['sh', 'bash', 'zsh', 'fish']) {
		// CI images carry sh and bash only; a shell that is not installed is skipped, not passed.
		const shell =
			process.platform === 'win32'
				? ''
				: spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
		it.skipIf(!shell)(`${name} hands the agent exactly its argv`, () => {
			const [file, ...args] = viaLoginShell(tricky, shell);
			// A scratch home: no profile or config of the person running the tests.
			const run = spawnSync(file, args, {
				encoding: 'utf8',
				env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, TERM: 'dumb' }
			});
			expect(run.stdout).toBe("<--no-daemon><two words><it's><$HOME><*>");
		});
	}

	it('runs the agent directly with no shell or one it cannot pass argv through', () => {
		expect(viaLoginShell(['claude'], '')).toEqual(['claude']);
		expect(viaLoginShell(['claude'], '/usr/bin/nu')).toEqual(['claude']);
		expect(viaLoginShell(['claude'], 'bash')).toEqual(['claude']);
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

	it.skipIf(process.platform !== 'linux')(
		"finds grok's session from the file its process holds open",
		async () => {
			const grokHome = join(dir, 'grok');
			const id = '01a1b2f9-b325-7f23-b50a-6bdcd8d4b303';
			const session = join(grokHome, 'sessions', '%2Fhome%2Fu%2Frepo', id);
			mkdirSync(session, { recursive: true });
			const held = openSync(join(session, 'events.jsonl'), 'a');
			const child = spawn('sleep', ['10'], { stdio: ['ignore', held, 'ignore'] });
			const previous = process.env.GROK_HOME;
			process.env.GROK_HOME = grokHome;
			try {
				expect(sessionForProcess('grok', child.pid ?? 0)).toBe(id);
				// Same process, wrong harness: nothing of copilot's is open.
				expect(sessionForProcess('copilot', child.pid ?? 0)).toBe('');
			} finally {
				process.env.GROK_HOME = previous;
				child.kill();
				closeSync(held);
			}
		}
	);

	it.skipIf(process.platform !== 'linux')(
		"finds copilot's session held by the CLI its node launcher started",
		async () => {
			const copilotHome = join(dir, 'copilot');
			const id = '981574c2-9fff-4f6b-8887-8329aa129576';
			mkdirSync(join(copilotHome, 'session-state', id), { recursive: true });
			const hold = join(copilotHome, 'session-state', id, 'inuse.1.hold');
			// `; true` keeps sh from exec-ing sleep, so the child holds the file, not sh.
			const launcher = spawn('sh', ['-c', 'sleep 10 3>>"$HOLD"; true'], {
				env: { ...process.env, HOLD: hold },
				stdio: 'ignore'
			});
			const previous = process.env.COPILOT_HOME;
			process.env.COPILOT_HOME = copilotHome;
			try {
				let found = '';
				// The child needs a moment to start and open the file.
				for (let i = 0; i < 40 && !found; i++) {
					found = sessionForProcess('copilot', launcher.pid ?? 0);
					if (!found) await new Promise((resolve) => setTimeout(resolve, 25));
				}
				expect(found).toBe(id);
			} finally {
				process.env.COPILOT_HOME = previous;
				launcher.kill();
			}
		}
	);

	it.skipIf(process.platform !== 'linux')(
		'finds nothing for a process with no session open',
		async () => {
			const child = spawn('sleep', ['10'], { stdio: 'ignore' });
			try {
				for (const kind of ['grok', 'copilot', 'agy'])
					expect(sessionForProcess(kind, child.pid ?? 0)).toBe('');
			} finally {
				child.kill();
			}
		}
	);
});

describe('sessionFromLinks', () => {
	const id = '59f90346-bba9-40e5-8351-10216b963406';
	const never = () => {
		throw new Error('only agy reads a log');
	};
	it("takes grok's id from the session folder it holds, under its own home only", () => {
		const links = [
			'/dev/pts/3',
			'/home/u/.grok/logs/unified.jsonl',
			`/home/other/.grok/sessions/x/${id}/events.jsonl`,
			`/home/u/.grok/sessions/%2Fhome%2Fu%2Frepo/${id}/events.jsonl`
		];
		expect(sessionFromLinks('grok', links, '/home/u/.grok', never)).toBe(id);
		expect(sessionFromLinks('grok', links.slice(0, 3), '/home/u/.grok', never)).toBe('');
	});
	it("takes copilot's id from its in-use hold file", () => {
		const links = [
			'/home/u/.copilot/session-store.db',
			`/home/u/.copilot/session-state/${id}/inuse.1918481.hold`
		];
		expect(sessionFromLinks('copilot', links, '/home/u/.copilot', never)).toBe(id);
		expect(
			sessionFromLinks(
				'copilot',
				['/home/u/.copilot/session-state/../../etc/inuse.1.hold'],
				'/home/u/.copilot',
				never
			)
		).toBe('');
	});
	it("reads agy's conversation from the log on its stdout", () => {
		const log = '/home/u/.gemini/antigravity-cli/log/cli-20261106_222559.log';
		const asked: string[] = [];
		const read = (path: string) => (asked.push(path), id);
		expect(sessionFromLinks('agy', ['/dev/pts/1', log], '/home/u/.gemini', read)).toBe(id);
		expect(asked).toEqual([log]);
		expect(sessionFromLinks('agy', ['/tmp/other.log'], '/home/u/.gemini', read)).toBe('');
	});
});

describe("agy's log", () => {
	const a = '95f42ca7-26e4-4655-a1a2-f3d32dd26d40';
	const b = '456c5fda-986e-478f-bd3d-cb9800b1b931';
	const other = 'e5b7bb48-1fb1-4522-a578-6344c4280b3d';
	it('takes the last conversation created or streamed, not ones it searched', () => {
		const log = [
			`W1106 22:26:00 extract_searchable_content.go:160] oversized step: conversation=${other} step=87`,
			`I1106 22:26:09 server.go:1242] Created conversation ${a} (backend=BACKEND_TYPE_UNSPECIFIED)`,
			`I1106 22:26:09 server.go:3369] GetConversationDetail: found conversation ${other} (active=true)`,
			`I1106 22:26:09 conversation_manager.go:1068] Streaming conversation ${a}`
		].join('\n');
		expect(agyConversation(log)).toBe(a);
		expect(
			agyConversation(`${log}\nI1106 conversation_manager.go:1068] Streaming conversation ${b}`)
		).toBe(b);
		expect(agyConversation('no conversation yet')).toBe('');
	});
	it('reads only what was added since, keeping a line cut mid-write', () => {
		const dir = mkdtempSync(join(tmpdir(), 'bordr-agy-'));
		try {
			const path = join(dir, 'cli.log');
			writeFileSync(path, 'I1106 startup\n');
			expect(agyLogConversation(path)).toBe('');
			appendFileSync(path, `I1106 Created conversation ${a}\nI1106 Streaming conv`);
			expect(agyLogConversation(path)).toBe(a);
			appendFileSync(path, `ersation ${b}\n`);
			expect(agyLogConversation(path)).toBe(b);
			// A log replaced by a shorter one is read from the start again.
			writeFileSync(path, `I1106 Created conversation ${other}\n`);
			expect(agyLogConversation(path)).toBe(other);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
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
										: msg.method === 'terminal.run'
											? { address: 't9' }
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

	it('starts codex without its daemon, so its work stays in the terminal', async () => {
		const client = new CoreClient(path);
		calls.length = 0;
		// No shell: the agent's own argv, unwrapped.
		expect(await client.startAgent('codex', '/home/u/repo', [], '')).toBe('t9');
		expect(await client.startAgent('codex', '/home/u/repo', ['--no-daemon'], '')).toBe('t9');
		await client.startAgent('claude', '/home/u/repo', [], '');
		expect(calls.map((c) => c.params.argv)).toEqual([
			['codex', '--no-daemon'],
			['codex', '--no-daemon'],
			['claude']
		]);
	});

	it("starts an agent through the user's login shell, as a TUI pane would", async () => {
		const client = new CoreClient(path);
		calls.length = 0;
		await client.startAgent('omp', '/home/u/repo', ['--cwd', '/home/u/repo'], '/usr/bin/fish');
		expect(calls[0].params.argv).toEqual([
			'/usr/bin/fish',
			'-l',
			'-i',
			'-c',
			'exec $argv',
			'omp',
			'--cwd',
			'/home/u/repo'
		]);
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

describe('finding a Claude session on another machine', () => {
	const run = (home: string, script: string, path = '/usr/bin:/bin') =>
		spawnSync('sh', ['-c', script], {
			encoding: 'utf8',
			env: { HOME: home, PATH: path }
		});

	function machine(records: Record<number, string>, children?: number[]) {
		const home = mkdtempSync(join(tmpdir(), 'bordr-claude-remote-'));
		mkdirSync(join(home, '.claude/sessions'), { recursive: true });
		for (const [pid, id] of Object.entries(records))
			writeFileSync(
				join(home, '.claude/sessions', `${pid}.json`),
				JSON.stringify({ pid: Number(pid), sessionId: id })
			);
		const bin = join(home, 'bin');
		mkdirSync(bin);
		// Stands in for the process walk; Windows ends its lines with \r\n.
		if (children) {
			writeFileSync(
				join(bin, 'powershell.exe'),
				`#!/bin/sh\nprintf '${children.map((c) => `${c}\\r\\n`).join('')}'\n`
			);
			chmodSync(join(bin, 'powershell.exe'), 0o755);
		}
		return { home, path: `${bin}:/usr/bin:/bin` };
	}

	it('reads the record under the foreground pid, as on Linux', () => {
		const { home, path } = machine({ 100: 'linux' });
		const out = run(home, claudeRemoteScript(100), path);
		expect(claudeSessionId(out.stdout)).toBe('linux');
		rmSync(home, { recursive: true });
	});

	it('finds it under a child of the shell, as on Windows, nearest first', () => {
		const { home, path } = machine({ 8404: 'windows', 9999: 'nested' }, [7777, 8404, 9999]);
		const out = run(home, claudeRemoteScript(12240), path);
		expect(claudeSessionId(out.stdout)).toBe('windows');
		expect(claudeRecordPid(out.stdout)).toBe(8404);
		rmSync(home, { recursive: true });
	});

	it('tries the pid found last time before walking, and walks again once it has gone', () => {
		const { home, path } = machine({ 8404: 'old' }, [5555]);
		// The stand-in would find nothing at 5555, so this answer came from `last`.
		expect(claudeSessionId(run(home, claudeRemoteScript(12240, 8404), path).stdout)).toBe('old');
		rmSync(join(home, '.claude/sessions/8404.json'));
		writeFileSync(
			join(home, '.claude/sessions/5555.json'),
			JSON.stringify({ pid: 5555, sessionId: 'new' })
		);
		expect(claudeSessionId(run(home, claudeRemoteScript(12240, 8404), path).stdout)).toBe('new');
		rmSync(home, { recursive: true });
	});

	it('fails quietly where there is no record and no powershell', () => {
		const { home, path } = machine({});
		const out = run(home, claudeRemoteScript(100), path);
		expect(out.status).toBe(1);
		expect(out.stdout).toBe('');
		rmSync(home, { recursive: true });
	});

	it('sends plain text: a raw carriage return does not survive the trip to Windows', () => {
		expect(claudeRemoteScript(12240, 8404)).not.toContain('\r');
	});

	it('takes only a real pid back out of a record', () => {
		expect(claudeRecordPid('{"pid":8404}')).toBe(8404);
		expect(claudeRecordPid('{"pid":"1; rm -rf ~"}')).toBeUndefined();
		expect(claudeRecordPid('{"pid":-1}')).toBeUndefined();
		expect(claudeRecordPid('nope')).toBeUndefined();
	});
});
