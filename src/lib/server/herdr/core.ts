import { HerdrClient, HerdrRequestError } from './client';
import { CORE_GENERATION } from './compat';
import { coreCall, corePaint, coreSubscribe, coreType } from './core-wire';
import { isTranscript, pickPiSession, piSessionDir, sessionForProcess } from './core-session';
import { paintToScreen } from './paint';
import type { HerdrEvent } from './protocol';

/**
 * herdr-core (`hc`) behind the TUI herdr's method names.
 *
 * Everything above the herdr layer speaks the TUI's socket API (`agent.list`,
 * `pane.read`, `pane.send_keys`, ...). Core has terminals, not panes; the
 * workspaces and tabs are herdr-app's, kept in core's `herdr-app` document.
 * This client answers the TUI calls bordr makes from those, so the routes,
 * the tree, push and the projector work unchanged. Layout edits (split, swap,
 * zoom, ratios, new tabs), worktrees and config reload have no core
 * equivalent and fail with `unsupported`; the UI hides them on core.
 *
 * shortcut: terminals on core's other machines (`tm-dev/t1`) are left out —
 * their transcripts live on that machine; add them through `on` when needed.
 */

export interface CoreTerminal {
	address: string;
	name?: string | null;
	cwd?: string;
	title?: string;
	cols?: number;
	rows?: number;
	pid?: number | null;
	parent?: string | null;
	state?: string;
	turn?: number;
	labels?: Record<string, string>;
	foreground?: { pid?: number; name?: string; argv?: string[]; cwd?: string } | null;
	status?: { app?: string; state?: string; kind?: string | null; msg?: string } | null;
	reported?: boolean;
}

interface Space {
	id?: string;
	name?: string;
	folder?: string;
	tabs?: Array<{ id?: string; name?: string; root?: unknown }>;
}

/** Harnesses bordr starts or reads; core's `status.app` spells some differently. */
const KINDS = new Set([
	'agy',
	'claude',
	'codex',
	'copilot',
	'cursor',
	'gemini',
	'grok',
	'opencode',
	'pi',
	'omp'
]);

export function agentKind(t: CoreTerminal): string {
	const app = (t.status?.app ?? '').replace(/-(code|cli)$/, '');
	if (KINDS.has(app)) return app;
	const exe = (t.foreground?.argv?.[0] ?? t.foreground?.name ?? '').split('/').pop() ?? '';
	if (KINDS.has(exe)) return exe;
	return t.reported && app ? app : '';
}

/**
 * Core's program-reported words onto bordr's. `error` needs a person as much
 * as `blocked` does. A `done` someone has already looked at (herdr-app's
 * `herdr.seen` label, docs/labels.md) is idle, on every client.
 */
export function agentStatus(t: CoreTerminal): string {
	const state = t.status?.state ?? '';
	if (state === 'error' || state === 'blocked') return 'blocked';
	if (state === 'working') return 'working';
	if (state === 'done') {
		const seen = Number(t.labels?.['herdr.seen']);
		return Number.isFinite(seen) && seen >= (t.turn ?? 0) ? 'idle' : 'done';
	}
	if (state === 'idle') return 'idle';
	return agentKind(t) ? 'unknown' : '';
}

/** Every terminal herdr-app has placed: terminal → its space and tab. */
export function placements(spaces: Space[]): Map<string, { space: string; tab: string }> {
	const out = new Map<string, { space: string; tab: string }>();
	const walk = (node: unknown, space: string, tab: string) => {
		if (!node || typeof node !== 'object') return;
		const n = node as { content?: { terminal?: unknown }; children?: unknown[] };
		if (typeof n.content?.terminal === 'string') out.set(n.content.terminal, { space, tab });
		for (const child of n.children ?? []) walk(child, space, tab);
	};
	for (const space of spaces)
		for (const tab of space.tabs ?? []) walk(tab.root, space.id ?? '', tab.id ?? '');
	return out;
}

/** Claude Code's pid record, as text from another machine. */
export function claudeSessionId(text: string): string {
	try {
		const id = JSON.parse(text)?.sessionId;
		return typeof id === 'string' ? id : '';
	} catch {
		return '';
	}
}

/** The pid in a Claude session record: it goes back into a shell script, so only a real number. */
export function claudeRecordPid(text: string): number | undefined {
	try {
		const pid = JSON.parse(text)?.pid;
		return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Print the session record of the Claude running as, or under, `pid`.
 *
 * Claude names the record after its own pid. On Linux core reports that pid. On
 * Windows it reports the shell Claude was started from, so the record is found
 * by walking down that shell's children, nearest first, so a Claude a hook or
 * sub-agent started never beats the one in the terminal. The walk takes over a
 * second, so `last` (the pid found last time) is tried before it.
 */
export const claudeRemoteScript = (pid: number, last?: number) =>
	[
		'd="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions"',
		`cat "$d/${pid}.json" 2>/dev/null && exit 0`,
		// shortcut: a Claude killed outright leaves its record, so a new one in the same shell shows the old chat until that file goes.
		...(last && last !== pid ? [`cat "$d/${last}.json" 2>/dev/null && exit 0`] : []),
		'command -v powershell.exe >/dev/null || exit 1',
		// Depth-limited because a reused Windows pid can make the parent links loop.
		`for p in $(powershell.exe -NoProfile -NonInteractive -Command '$all = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId; $q = @(${pid}); for ($i = 0; $i -lt 6 -and $q.Count; $i++) { $next = @(); foreach ($p in $all) { if ($q -contains $p.ParentProcessId) { $p.ProcessId; $next += $p.ProcessId } }; $q = $next }' | tr -d '\\r'); do cat "$d/$p.json" 2>/dev/null && exit 0; done`,
		'exit 1'
	].join('\n');

/** The transcript in a remote `echo $HOME; readlink /proc/<pid>/fd/*` listing. */
export function openTranscript(kind: string, text: string): string {
	const [home, ...links] = text.split('\n').map((line) => line.trim());
	const dir = { codex: '.codex/sessions/', omp: '.omp/agent/sessions/', pi: '.pi/agent/sessions/' }[
		kind
	];
	if (!home?.startsWith('/') || !dir) return '';
	return links.find((link) => isTranscript(link, [`${home}/${dir}`])) ?? '';
}

/**
 * What pi's session needs from its machine, one fact per line: home, the
 * process's folder, `btime starttime` (seconds, clock ticks), then the
 * names in pi's folder for it. `pid` is an integer from core, never text.
 */
const PI_REMOTE_SCRIPT = (pid: number) =>
	[
		'echo "$HOME"',
		`d=$(readlink /proc/${pid}/cwd); echo "$d"`,
		`echo "$(awk '/^btime/{print $2}' /proc/stat) $(cut -d')' -f2- /proc/${pid}/stat | awk '{print $20}')"`,
		`ls "$HOME/.pi/agent/sessions/--$(printf '%s' "$d" | sed 's|^/||; s|/|-|g')--"`
	].join('; ');

/** pi's session from PI_REMOTE_SCRIPT's answer, by the same rule as here. */
export function remotePiSession(text: string): string {
	const [home, cwd, clock, ...names] = text.split('\n').map((line) => line.trim());
	const [btime, ticks] = (clock ?? '').split(' ').map(Number);
	if (
		!home?.startsWith('/') ||
		!cwd?.startsWith('/') ||
		!Number.isFinite(btime) ||
		!Number.isFinite(ticks)
	)
		return '';
	// shortcut: assumes CLK_TCK is 100 there too, as on every mainstream Linux build.
	const name = pickPiSession(names, btime * 1000 + ticks * 10);
	return name ? `${piSessionDir(`${home}/.pi/agent/sessions`, cwd)}/${name}` : '';
}

/** Where terminals herdr-app never placed (an agent's helpers, `hc run`) are filed. */
const OTHER_SPACE = 'core-other';
const OTHER_TAB = 'core-other:1';

interface View {
	terminals: CoreTerminal[];
	spaces: Space[];
	placed: Map<string, { space: string; tab: string }>;
}

export class CoreClient extends HerdrClient {
	readonly backend = 'core';
	/** `<name>/` for a machine core links, '' for this host. */
	private readonly prefix: string;
	/** Remote session lookups by pid: one `machine.exec` per agent, not per poll. */
	private readonly remoteSessions = new Map<number, { value: string; at: number; last?: number }>();

	constructor(
		socketPath: string,
		timeoutMs?: number,
		sourceScope = '',
		/** Another machine core links, named as core names it; '' for this host. */
		readonly machine = ''
	) {
		super(socketPath, timeoutMs, sourceScope);
		this.prefix = machine ? `${machine}/` : '';
	}

	/**
	 * Start a harness in a terminal of its own and return its address. Core
	 * has no workspace to create; herdr-app files it where it likes, and
	 * bordr lists it under "Other" until then. `herdr.seen=0` is what
	 * herdr-app's docs/labels.md asks of a client that starts a terminal.
	 */
	async startAgent(kind: string, cwd: string, args: string[] = []): Promise<string> {
		const result = await this.call<{ address?: string; terminal?: { address?: string } }>(
			'terminal.run',
			{ argv: [kind, ...args], cwd, no_parent: true, labels: { 'herdr.seen': '0' } },
			60_000
		);
		const address = result.address ?? result.terminal?.address;
		if (!address) throw new HerdrRequestError('protocol_error', 'terminal.run returned no address');
		return address;
	}

	private call<T>(method: string, params: unknown = {}, timeoutMs?: number): Promise<T> {
		return coreCall<T>(this.socketPath, method, params, timeoutMs);
	}

	private async view(): Promise<View> {
		const [list, doc] = await Promise.all([
			this.call<{ terminals?: CoreTerminal[] }>('terminal.list'),
			this.call<{ value?: { spaces?: Space[] } | null }>('doc.get', {
				name: 'herdr-app',
				...(this.machine ? { on: this.machine } : {})
			}).catch(() => ({ value: null }))
		]);
		const spaces = doc.value?.spaces ?? [];
		// This client's machine only, in that machine's own addresses (`t7`).
		const own = (address: string) =>
			this.prefix ? address.startsWith(this.prefix) : !address.includes('/');
		const bare = (address: string) => address.slice(this.prefix.length);
		const terminals = (list.terminals ?? [])
			.filter((t) => own(t.address))
			.map((t) => ({
				...t,
				address: bare(t.address),
				parent: t.parent && own(t.parent) ? bare(t.parent) : null
			}));
		if (this.prefix) await this.lookUpRemoteSessions(terminals);
		return { terminals, spaces, placed: placements(spaces) };
	}

	/**
	 * Sessions for agents on another machine, found there the same way as
	 * here (core-session.ts), through `machine.exec`. Cached per pid; a miss
	 * is asked again after a few seconds, as a new agent writes its record late.
	 */
	private async lookUpRemoteSessions(terminals: CoreTerminal[]): Promise<void> {
		const now = Date.now();
		await Promise.all(
			terminals.map(async (t) => {
				const kind = agentKind(t);
				const pid = t.foreground?.pid;
				if (!kind || !pid || !Number.isInteger(pid)) return;
				const known = this.remoteSessions.get(pid);
				// Claude's id can change under the same pid: `/clear`, or on Windows a
				// new Claude in the same shell. The others keep theirs for life.
				const wait = !known?.value ? 10_000 : kind === 'claude' ? 30_000 : Infinity;
				if (known && now - known.at < wait) return;
				// Stamped first: a slow look-up must not start again on every refresh.
				this.remoteSessions.set(pid, { value: known?.value ?? '', last: known?.last, at: now });
				const script =
					kind === 'claude'
						? claudeRemoteScript(pid, known?.last)
						: kind === 'pi'
							? PI_REMOTE_SCRIPT(pid)
							: `echo "$HOME"; for f in /proc/${pid}/fd/*; do readlink "$f"; done`;
				// Unreachable for now: keep what was known, and ask again after the wait.
				let value = known?.value ?? '';
				let last = known?.last;
				try {
					const out = await this.call<{ code?: number | null; stdout?: string }>(
						'machine.exec',
						{ on: this.machine, argv: ['sh', '-c', script], timeout: 10 },
						13_000
					);
					const text = Buffer.from(out.stdout ?? '', 'base64').toString('utf8');
					value =
						kind === 'claude'
							? claudeSessionId(text)
							: kind === 'pi'
								? remotePiSession(text)
								: openTranscript(kind, text);
					last = kind === 'claude' ? claudeRecordPid(text) : undefined;
				} catch {
					// see above
				}
				this.remoteSessions.set(pid, { value, last, at: now });
			})
		);
	}

	private where(view: View, t: CoreTerminal): { space: string; tab: string } {
		const placed =
			view.placed.get(t.address) ??
			(t.labels?.['herdr.tab'] && t.labels?.['herdr.space']
				? { space: t.labels['herdr.space'], tab: t.labels['herdr.tab'] }
				: undefined);
		if (placed) return placed;
		// A helper sits with the agent that started it.
		const parent = t.parent ? view.placed.get(t.parent) : undefined;
		return parent ?? { space: OTHER_SPACE, tab: OTHER_TAB };
	}

	/** One terminal as the TUI's `pane.list` / `agent.list` record. */
	private record(view: View, t: CoreTerminal): Record<string, unknown> {
		const { space, tab } = this.where(view, t);
		const kind = agentKind(t);
		const pid = t.foreground?.pid;
		const session =
			kind && pid
				? this.prefix
					? (this.remoteSessions.get(pid)?.value ?? '')
					: sessionForProcess(kind, pid)
				: '';
		return {
			pane_id: t.address,
			workspace_id: space,
			tab_id: tab,
			agent: kind,
			agent_status: agentStatus(t),
			state_change_seq: t.turn ?? 0,
			...(session ? { agent_session: { value: session } } : {}),
			name: t.name ?? '',
			terminal_title: t.title ?? '',
			terminal_title_stripped: t.title ?? '',
			cwd: t.cwd ?? '',
			foreground_cwd: t.foreground?.cwd ?? '',
			focused: false,
			launch_pending: false,
			// What a blocked agent is asking, in its own words. Unused by the TUI path.
			core_status: t.status ?? null
		};
	}

	private async terminal(address: unknown): Promise<CoreTerminal> {
		const result = await this.call<{ terminal?: CoreTerminal } & CoreTerminal>('terminal.get', {
			terminal: String(address ?? '')
		});
		return (result.terminal ?? result) as CoreTerminal;
	}

	/** The machines this core links (`hc machine ls`). */
	async machines(): Promise<Array<{ name: string; target?: string; state?: string }>> {
		const result = await this.call<{
			machines?: Array<{ name: string; target?: string; state?: string }>;
		}>('machine.list');
		return result.machines ?? [];
	}

	/** Whether core reports this terminal as blocked right now. */
	async isBlocked(address: string): Promise<boolean> {
		return (await this.terminal(this.prefix + address)).status?.state === 'blocked';
	}

	/**
	 * Share "a person looked at it" with herdr-app and other clients
	 * (herdr-app docs/labels.md): write `herdr.seen=<turn>`, only ever raising it.
	 */
	async markSeen(address: string, turn: number): Promise<void> {
		if (address.includes('/')) return;
		address = this.prefix + address;
		const t = await this.terminal(address);
		const seen = Number(t.labels?.['herdr.seen']);
		if (Number.isFinite(seen) && seen >= turn) return;
		await this.call('terminal.label', {
			terminal: address,
			labels: { 'herdr.seen': String(turn) }
		});
	}

	override async request<T = Record<string, unknown>>(
		method: string,
		params: Record<string, unknown> = {},
		timeoutMs?: number
	): Promise<T> {
		const bare = String(params.pane_id ?? params.target ?? '');
		// `mac/t7` is core's address for a terminal on another machine. bordr
		// hands out bare ids and picks the machine itself, so a slash here was
		// never handed out by us.
		if (bare.includes('/')) throw new HerdrRequestError('not_found', `no terminal ${bare}`);
		const target = this.prefix + bare;
		switch (method) {
			case 'ping': {
				const hello = await this.call<{
					version?: string;
					generation?: number;
					core?: { name?: string };
				}>('hello', { generation: CORE_GENERATION });
				return {
					backend: 'core',
					version: hello.version ?? null,
					generation: hello.generation ?? null,
					core_name: hello.core?.name ?? ''
				} as T;
			}
			case 'agent.list': {
				const view = await this.view();
				const agents = view.terminals
					.filter((t) => t.state === 'live' && agentKind(t))
					.map((t) => this.record(view, t));
				return { agents } as T;
			}
			case 'pane.list': {
				const view = await this.view();
				const panes = view.terminals
					.filter((t) => t.state === 'live')
					.map((t) => this.record(view, t));
				return { panes } as T;
			}
			case 'workspace.list':
			case 'tab.list': {
				const view = await this.view();
				const live = view.terminals.filter((t) => t.state === 'live');
				// herdr-app writes the name it shows on each terminal as `where`
				// ("space / tab"). The doc's `folder` is where the space was made and
				// goes stale once its terminals move on, so it is only the fallback.
				const shown = new Map<string, string>();
				for (const t of live) {
					const where = t.labels?.where?.split(' / ')[0];
					if (where) shown.set(this.where(view, t).space, where);
				}
				const workspaces = view.spaces.map((s, i) => ({
					workspace_id: s.id ?? '',
					label:
						s.name ||
						shown.get(s.id ?? '') ||
						(s.folder ?? '').split('/').filter(Boolean).pop() ||
						'',
					number: i + 1,
					focused: false
				}));
				const tabs = view.spaces.flatMap((s) =>
					(s.tabs ?? []).map((tab, i) => ({
						tab_id: tab.id ?? '',
						workspace_id: s.id ?? '',
						label: tab.name ?? '',
						number: i + 1,
						focused: false
					}))
				);
				if (live.some((t) => this.where(view, t).space === OTHER_SPACE)) {
					workspaces.push({
						workspace_id: OTHER_SPACE,
						label: 'Other',
						number: workspaces.length + 1,
						focused: false
					});
					tabs.push({
						tab_id: OTHER_TAB,
						workspace_id: OTHER_SPACE,
						label: '',
						number: 1,
						focused: false
					});
				}
				return (method === 'workspace.list' ? { workspaces } : { tabs }) as T;
			}
			case 'agent.read':
			case 'pane.read': {
				const visible = (params.source ?? 'visible') === 'visible';
				const lines = visible ? 0 : Number(params.lines ?? 200);
				if (params.format === 'ansi') {
					const paint = await corePaint(this.socketPath, target, lines);
					return { read: { text: paintToScreen(paint) } } as T;
				}
				const result = await this.call<{ text?: string }>('terminal.read', {
					terminal: target,
					lines
				});
				return { read: { text: result.text ?? '' } } as T;
			}
			case 'agent.send_keys':
			case 'pane.send_keys':
				await this.call('terminal.keys', { terminal: target, keys: params.keys });
				return {} as T;
			case 'pane.send_text': {
				const t = await this.terminal(target);
				await coreType(this.socketPath, target, String(params.text ?? ''), {
					cols: t.cols ?? 80,
					rows: t.rows ?? 24
				});
				return {} as T;
			}
			case 'agent.prompt':
				// No `force`: typing into a blocked agent can answer its dialog (a
				// permission "Yes"). Core refuses like the TUI did, and the routes
				// already turn `agent_blocked` into "answer it in terminal view".
				try {
					await this.call(
						'terminal.send',
						{ terminal: target, text: String(params.text ?? '') },
						timeoutMs
					);
				} catch (e) {
					if (e instanceof HerdrRequestError && e.code === 'blocked')
						throw new HerdrRequestError('agent_blocked', e.message);
					throw e;
				}
				return {} as T;
			case 'pane.process_info': {
				const t = await this.terminal(target);
				const fg = t.foreground;
				return {
					process_info: {
						shell_pid: t.pid ?? null,
						foreground_processes: fg ? [{ pid: fg.pid, name: fg.name, argv: fg.argv }] : []
					}
				} as T;
			}
			case 'pane.close':
				// A pane is a terminal: closing it ends its program, as on the TUI.
				await this.call('terminal.kill', { terminal: target });
				return {} as T;
			default:
				throw new HerdrRequestError('unsupported', `${method} is not available on herdr-core`);
		}
	}

	override async subscribe(
		_subscriptions: Array<Record<string, unknown>>,
		onEvent: (e: HerdrEvent) => void,
		onClose?: () => void
	): Promise<() => void> {
		const { close } = await coreSubscribe(
			this.socketPath,
			(method, params) => {
				const event = translateEvent(method, params);
				if (event) onEvent(event);
			},
			onClose
		);
		return close;
	}
}

/** Core notifications as the TUI events push and the projector listen for. */
export function translateEvent(method: string, params: Record<string, unknown>): HerdrEvent | null {
	if (method === 'missed') return { event: 'pane.updated', data: { type: 'pane.updated' } };
	if (method !== 'event') return null;
	const type = String(params.type ?? '');
	if (type === 'doc') return { event: 'layout.updated', data: { type: 'layout.updated' } };
	const pane_id = String(params.terminal ?? '');
	if (!pane_id || pane_id.includes('/')) return null;
	const named = (event: string, extra: Record<string, unknown> = {}): HerdrEvent => ({
		event,
		data: { type: event, pane_id, ...extra }
	});
	switch (type) {
		case 'created':
		case 'restarted':
			return named('pane.created');
		case 'removed':
			return named('pane.closed');
		case 'finished':
		case 'lost':
			return named('pane.exited');
		case 'status': {
			const data = (params.data ?? {}) as { status?: CoreTerminal['status'] };
			const state = data.status?.state ?? '';
			const agent_status =
				state === 'error'
					? 'blocked'
					: ['idle', 'working', 'blocked', 'done'].includes(state)
						? state
						: 'unknown';
			return named('pane.agent_status_changed', { agent_status });
		}
		default:
			return named('pane.updated');
	}
}
