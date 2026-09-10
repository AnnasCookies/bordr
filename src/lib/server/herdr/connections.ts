import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HerdrClient } from './client';
import { listMachines, type Machine } from './machines';

/**
 * A herdr server on another host, reached through its own unix socket.
 *
 * herdr's socket API has no machine concept — machines are a client feature,
 * and each host runs its own server. So bordr does what the TUI does: it
 * connects to each one. The transport is an SSH unix-socket forward, which
 * means the wire protocol is byte-for-byte the local one and every existing
 * request, subscription and read works unchanged.
 *
 *   ssh -fnNT -L <local.sock>:<remote.sock> <target>
 *
 * Verified against a live herdr 0.9.0 on tm-dev: ping, pane.list and
 * agent.read all answer over the forward.
 */
export interface Connection {
	machine: Machine;
	socketPath: string;
	client: HerdrClient;
	/** Null until the first successful call; set when a connection fails. */
	error: string | null;
}

function runtimeDir(): string {
	const base = process.env.XDG_RUNTIME_DIR || tmpdir();
	const dir = join(base, 'bordr-machines');
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	return dir;
}

const connections = new Map<string, Connection>();
const starting = new Map<string, Promise<Connection | null>>();
const lastFailure = new Map<string, number>();
/** How long a machine that failed to connect is left alone. */
const RETRY_MS = 30_000;

/**
 * Bring up the forward for one machine, or return the live one.
 *
 * Memoised on the in-flight promise: two requests arriving together would
 * otherwise each spawn ssh and race for the same socket path.
 */
/**
 * When each machine last proved itself with a real request.
 *
 * A socket file is not a connection — a dead forward leaves one behind — so
 * liveness has to be proven. But proving it on every call meant a round trip
 * per machine per poll, so a good answer is trusted for a while.
 */
const provenAt = new Map<string, number>();
const PROVEN_MS = 20_000;

async function alive(connection: Connection): Promise<boolean> {
	if (!existsSync(connection.socketPath)) return false;
	const last = provenAt.get(connection.machine.id) ?? 0;
	if (Date.now() - last < PROVEN_MS) return true;
	try {
		await connection.client.request('ping', {}, 4000);
		provenAt.set(connection.machine.id, Date.now());
		return true;
	} catch {
		provenAt.delete(connection.machine.id);
		return false;
	}
}

async function connect(machine: Machine): Promise<Connection | null> {
	const live = connections.get(machine.id);
	if (live && !live.error && (await alive(live))) return live;

	const pending = starting.get(machine.id);
	if (pending) return pending;

	// A machine that just failed is not retried on the next poll: the connect
	// itself costs an ssh timeout, which is the whole reason a down machine
	// made everything slow.
	const failedAt = lastFailure.get(machine.id) ?? 0;
	if (Date.now() - failedAt < RETRY_MS) return null;

	const attempt = (async (): Promise<Connection | null> => {
		const socketPath = join(runtimeDir(), `${machine.id}.sock`);
		// A socket left by a dead forward refuses connections forever.
		rmSync(socketPath, { force: true });

		const home = await remoteHome(machine);
		if (!home) {
			lastFailure.set(machine.id, Date.now());
			connections.set(machine.id, {
				machine,
				socketPath,
				client: new HerdrClient(socketPath),
				error: `could not reach ${machine.target} over ssh`
			});
			return null;
		}

		const child = spawn(
			'ssh',
			[
				'-o',
				'BatchMode=yes',
				'-o',
				'ConnectTimeout=8',
				'-o',
				'ServerAliveInterval=15',
				// Reuse one connection for the forward and any file reads.
				'-o',
				'ControlMaster=auto',
				'-o',
				`ControlPath=${join(runtimeDir(), `${machine.id}.ctl`)}`,
				'-o',
				'ControlPersist=300',
				'-fnNT',
				'-L',
				`${socketPath}:${remoteSocketPath(home, machine)}`,
				machine.target
			],
			{ stdio: ['ignore', 'ignore', 'pipe'] }
		);

		let stderr = '';
		child.stderr?.on('data', (chunk) => (stderr += String(chunk)));

		const ready = await new Promise<boolean>((resolve) => {
			// -f backgrounds itself once the forward is up, so the child exits.
			child.on('exit', (code) => resolve(code === 0));
			child.on('error', () => resolve(false));
			setTimeout(() => resolve(existsSync(socketPath)), 12_000);
		});

		if (!ready || !existsSync(socketPath)) {
			lastFailure.set(machine.id, Date.now());
			connections.set(machine.id, {
				machine,
				socketPath,
				client: new HerdrClient(socketPath),
				error: stderr.trim().split('\n').pop() || 'ssh forward did not come up'
			});
			return null;
		}

		const connection: Connection = {
			machine,
			socketPath,
			client: new HerdrClient(socketPath),
			error: null
		};
		connections.set(machine.id, connection);
		lastFailure.delete(machine.id);
		provenAt.set(machine.id, Date.now());
		console.log(`bordr: machine ${machine.label} connected via ${machine.target}`);
		return connection;
	})();

	starting.set(machine.id, attempt);
	try {
		return await attempt;
	} finally {
		starting.delete(machine.id);
	}
}

/**
 * The remote socket path, ABSOLUTE.
 *
 * `ssh -L local.sock:remote.sock` does not expand `~` and does not resolve a
 * relative path — it opens the local end regardless and the channel then
 * fails, which arrives as ECONNRESET on the first request rather than as an
 * error from ssh. So the remote home is asked for once and cached.
 */
const homes = new Map<string, string>();

async function remoteHome(machine: Machine): Promise<string | null> {
	const cached = homes.get(machine.id);
	if (cached) return cached;
	const home = await new Promise<string | null>((resolve) => {
		const child = spawn(
			'ssh',
			[
				'-o',
				'BatchMode=yes',
				'-o',
				'ConnectTimeout=8',
				'-o',
				'ControlMaster=auto',
				'-o',
				`ControlPath=${join(runtimeDir(), `${machine.id}.ctl`)}`,
				'-o',
				'ControlPersist=300',
				machine.target,
				'printf %s "$HOME"'
			],
			{ stdio: ['ignore', 'pipe', 'ignore'] }
		);
		let out = '';
		child.stdout.on('data', (chunk) => (out += String(chunk)));
		child.on('exit', (code) => resolve(code === 0 && out.startsWith('/') ? out.trim() : null));
		child.on('error', () => resolve(null));
		setTimeout(() => resolve(null), 15_000);
	});
	if (home) homes.set(machine.id, home);
	return home;
}

function remoteSocketPath(home: string, machine: Machine): string {
	// herdr keeps one socket per session; a non-default session sits under
	// sessions/<name>/.
	return machine.session && machine.session !== 'default'
		? `${home}/.config/herdr/sessions/${machine.session}/herdr.sock`
		: `${home}/.config/herdr/herdr.sock`;
}

/** Every enabled machine that is currently reachable. */
export async function activeConnections(): Promise<Connection[]> {
	const machines = listMachines().filter((m) => m.enabled);
	const settled = await Promise.all(machines.map((m) => connect(m)));
	return settled.filter((c): c is Connection => c !== null);
}

/** The last known state of every enabled machine, connected or not. */
export function connectionStates(): Connection[] {
	return listMachines()
		.filter((m) => m.enabled)
		.map(
			(m) =>
				connections.get(m.id) ?? {
					machine: m,
					socketPath: '',
					client: new HerdrClient(''),
					error: null
				}
		);
}

export type MachineState = 'connected' | 'connecting' | 'unreachable';

/**
 * What each enabled machine is actually doing.
 *
 * Reported rather than inferred from whether its panes are in the tree: the
 * tree is refreshed in the background, so a machine that is perfectly fine
 * looks absent for the first second or two after a cold start — which read
 * as "offline" in the sidebar.
 */
export function machineStates(): { machine: Machine; state: MachineState; error: string | null }[] {
	return listMachines()
		.filter((m) => m.enabled)
		.map((machine) => {
			const connection = connections.get(machine.id);
			if (connection && !connection.error) {
				return { machine, state: 'connected' as const, error: null };
			}
			if (starting.has(machine.id)) {
				return { machine, state: 'connecting' as const, error: null };
			}
			if (connection?.error) {
				return { machine, state: 'unreachable' as const, error: connection.error };
			}
			// Never attempted yet — the background refresh is about to.
			return { machine, state: 'connecting' as const, error: null };
		});
}

export function connectionFor(machineId: string): Connection | undefined {
	return connections.get(machineId);
}

/**
 * The connection for a machine, opening it if this is the first time.
 *
 * Any route can be the first to touch a machine — a conversation opened from
 * a bookmark reaches one before the tree ever has — so connecting lazily here
 * beats requiring some other call to have warmed it.
 */
export async function ensureConnection(machineId: string): Promise<Connection | null> {
	const live = connections.get(machineId);
	if (live && !live.error && (await alive(live))) return live;
	const machine = listMachines().find((m) => m.id === machineId && m.enabled);
	if (!machine) return null;
	return connect(machine);
}

/**
 * Run a command on a machine and return its stdout.
 *
 * Rides the same ControlMaster the forward opened, so this is a channel on an
 * existing connection rather than a new SSH handshake.
 */
export function runOn(
	machine: Machine,
	command: string,
	limitBytes = 4 * 1024 * 1024
): Promise<string | null> {
	return new Promise((resolve) => {
		const child = spawn(
			'ssh',
			[
				'-o',
				'BatchMode=yes',
				'-o',
				'ConnectTimeout=8',
				'-o',
				'ControlMaster=auto',
				'-o',
				`ControlPath=${join(runtimeDir(), `${machine.id}.ctl`)}`,
				'-o',
				'ControlPersist=300',
				machine.target,
				command
			],
			{ stdio: ['ignore', 'pipe', 'ignore'] }
		);
		const chunks: Buffer[] = [];
		let size = 0;
		child.stdout.on('data', (chunk: Buffer) => {
			size += chunk.length;
			// Bounded: a transcript on the far side can be tens of megabytes,
			// and the caller only ever wants a tail of it.
			if (size <= limitBytes) chunks.push(chunk);
		});
		child.on('exit', (code) => resolve(code === 0 ? Buffer.concat(chunks).toString('utf8') : null));
		child.on('error', () => resolve(null));
		setTimeout(() => {
			child.kill();
			resolve(null);
		}, 20_000);
	});
}

/**
 * The tail of a harness transcript on a machine.
 *
 * The session id names a file whose project directory depends on the pane's
 * cwd, exactly as it does locally — so the far side does the search. `tail
 * -c` rather than `cat`: the window is what the parser wants and the file can
 * be enormous.
 */
/** Wrap for one pass through a POSIX shell, with no expansion at all. */
export function shellQuote(value: string): string {
	return `'${value.split("'").join(`'\\''`)}'`;
}

export async function remoteTranscriptTail(
	machine: Machine,
	agent: string,
	sessionId: string,
	bytes: number
): Promise<string | null> {
	// Only the harnesses whose on-disk layout bordr knows.
	const globs: Record<string, string> = {
		claude: '"$HOME"/.claude/projects/*/"$ID".jsonl',
		codex: '"$HOME"/.codex/sessions/*/*/*/"$ID".jsonl'
	};
	const glob = globs[agent];
	if (!glob) return null;

	// Single-quoted so a session id from herdr can never become shell syntax.
	const id = `'${sessionId.replace(/'/g, `'\\''`)}'`;
	const script = [
		`ID=${id}`,
		'shopt -s nullglob',
		`for f in ${glob}; do tail -c ${bytes} "$f"; exit 0; done`,
		'exit 1'
	].join('; ');

	// Single-quoted, not JSON-quoted: ssh hands the command to the remote
	// user's shell, which expands a double-quoted "$ID" itself — leaving the
	// glob looking for `*/.jsonl` and matching nothing.
	return runOn(machine, `bash -lc ${shellQuote(script)}`, bytes + 65536);
}
