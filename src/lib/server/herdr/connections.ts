import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

/**
 * Which bordr this is, as a short stable name.
 *
 * One host can run several instances — this one runs `bordr` and
 * `bordr-dulce` side by side — and they share a user, so a per-user runtime
 * directory made their forwards collide: one instance's connect deleted the
 * `<machine>.sock` the other was using and cancelled its forward through the
 * shared control master. The data directory is what already makes an
 * instance itself (its read state, push subscriptions and uploads live
 * there), and the port separates two that were pointed at one directory by
 * mistake. Hashed because a path is too long for a unix socket's name.
 */
function instanceKey(): string {
	const dataDir = resolve(process.env.BORDR_DATA_DIR ?? join(process.cwd(), '.data'));
	return createHash('sha256')
		.update(`${dataDir}\0${process.env.PORT ?? ''}`)
		.digest('hex')
		.slice(0, 12);
}

/**
 * Refuse a directory someone else could swap sockets in.
 *
 * `mkdirSync`'s mode applies only to a directory it creates, so an existing
 * one is checked rather than trusted. That matters most on the `tmpdir()`
 * fallback, where any local user can create `bordr-machines` first and wait
 * for bordr to put its control sockets inside. A symlink or another owner is
 * refused outright; a directory of our own that has loosened is tightened.
 */
function ensurePrivateDir(path: string): void {
	mkdirSync(path, { recursive: true, mode: 0o700 });
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || !stat.isDirectory()) {
		throw new Error(`${path} is not a directory`);
	}
	// No uid and no meaningful mode bits on Windows, where there is also no
	// ssh control master to protect.
	if (typeof process.getuid !== 'function') return;
	if (stat.uid !== process.getuid()) {
		throw new Error(`${path} is owned by uid ${stat.uid}, not this user`);
	}
	if ((stat.mode & 0o077) !== 0) chmodSync(path, 0o700);
}

/** Where this instance keeps its forwarded sockets and control masters. */
export function runtimeDir(): string {
	const base = join(process.env.XDG_RUNTIME_DIR || tmpdir(), 'bordr-machines');
	const dir = join(base, instanceKey());
	ensurePrivateDir(base);
	ensurePrivateDir(dir);
	return dir;
}

/**
 * ssh's argument list, with the target where ssh cannot mistake it for an
 * option.
 *
 * The target comes from herdr's endpoints file. `listMachines` already
 * refuses one that starts with `-`, and `--` makes that true of every spawn
 * whatever the list lets through: a target of `-oProxyCommand=…` would
 * otherwise be read as an option and run a local command.
 */
export function sshArgs(
	options: readonly string[],
	target: string,
	command: string[] = []
): string[] {
	return [...options, '--', target, ...command];
}

/** Stop a child that outlived its budget, so a hung ssh is not left behind. */
function killOnTimeout(
	child: ReturnType<typeof spawn>,
	ms: number,
	onTimeout: () => void
): () => void {
	const timer = setTimeout(() => {
		child.kill();
		onTimeout();
	}, ms);
	return () => clearTimeout(timer);
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

/**
 * Tell a control master to forget a forward, so it can be asked for again.
 *
 * Best effort by design: no master, no forward, or an ssh too old to know
 * `-O cancel` all mean there is nothing to undo, which is the same outcome.
 */
export function cancelForward(
	controlPath: string,
	socketPath: string,
	remote: string,
	target: string
): Promise<void> {
	return new Promise((done) => {
		if (!existsSync(controlPath)) return done();
		const child = spawn(
			'ssh',
			sshArgs(
				['-o', `ControlPath=${controlPath}`, '-O', 'cancel', '-L', `${socketPath}:${remote}`],
				target
			),
			{ stdio: 'ignore' }
		);
		// Never let a wedged master hold up the connect that follows it — and
		// kill the child rather than only stop waiting for it: every connect
		// attempt otherwise left one more hung ssh running.
		const stop = killOnTimeout(child, CANCEL_TIMEOUT_MS, done);
		const finish = () => {
			stop();
			done();
		};
		child.on('exit', finish);
		child.on('error', finish);
	});
}

const CANCEL_TIMEOUT_MS = 4_000;

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
		let dir: string;
		try {
			dir = runtimeDir();
		} catch (e) {
			// Recorded as this machine's error rather than thrown: a throw here
			// surfaced nowhere, because the tree's background refresh treats a
			// failed `activeConnections` as "no machines this time".
			const reason = `bordr's runtime directory is unusable: ${e instanceof Error ? e.message : String(e)}`;
			console.error(`bordr: machine ${machine.label} — ${reason}`);
			lastFailure.set(machine.id, Date.now());
			connections.set(machine.id, {
				machine,
				socketPath: '',
				client: new HerdrClient(''),
				error: reason
			});
			return null;
		}
		const socketPath = join(dir, `${machine.id}.sock`);
		const controlPath = join(dir, `${machine.id}.ctl`);
		// A socket left by a dead forward refuses connections forever.
		rmSync(socketPath, { force: true });

		const home = await remoteHome(machine, controlPath);
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

		const remote = remoteSocketPath(home, machine);
		// Deleting the socket FILE is not enough while a control master is up.
		//
		// The master keeps its own register of forwards. Ask it for one it
		// already believes it has and it agrees instantly and does nothing:
		// ssh exits 0, no socket appears, and stderr is empty — so the only
		// symptom is every machine reading "no answer", with no reason
		// anywhere. `ControlPersist` outlives bordr, so the state that
		// causes it survives a restart and never clears itself.
		//
		// Cancelling first makes the request real again. Failing is the
		// normal case — usually there is no master — so it is ignored.
		await cancelForward(controlPath, socketPath, remote, machine.target);

		const child = spawn(
			'ssh',
			sshArgs(
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
					`ControlPath=${controlPath}`,
					'-o',
					'ControlPersist=300',
					'-fnNT',
					'-L',
					`${socketPath}:${remote}`
				],
				machine.target
			),
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

async function remoteHome(machine: Machine, controlPath: string): Promise<string | null> {
	const cached = homes.get(machine.id);
	if (cached) return cached;
	const home = await new Promise<string | null>((done) => {
		const child = spawn(
			'ssh',
			sshArgs(
				[
					'-o',
					'BatchMode=yes',
					'-o',
					'ConnectTimeout=8',
					'-o',
					'ControlMaster=auto',
					'-o',
					`ControlPath=${controlPath}`,
					'-o',
					'ControlPersist=300'
				],
				machine.target,
				['printf %s "$HOME"']
			),
			{ stdio: ['ignore', 'pipe', 'ignore'] }
		);
		let out = '';
		// Killed, not abandoned, for the same reason as `cancelForward`.
		const stop = killOnTimeout(child, 15_000, () => done(null));
		child.stdout.on('data', (chunk) => (out += String(chunk)));
		child.on('exit', (code) => {
			stop();
			done(code === 0 && out.startsWith('/') ? out.trim() : null);
		});
		child.on('error', () => {
			stop();
			done(null);
		});
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
		let dir: string;
		try {
			dir = runtimeDir();
		} catch (e) {
			// Logged, and the same "no answer" every other failure here gives.
			console.error(
				`bordr: machine ${machine.label} — bordr's runtime directory is unusable:`,
				e instanceof Error ? e.message : String(e)
			);
			resolve(null);
			return;
		}
		const child = spawn(
			'ssh',
			sshArgs(
				[
					'-o',
					'BatchMode=yes',
					'-o',
					'ConnectTimeout=8',
					'-o',
					'ControlMaster=auto',
					'-o',
					`ControlPath=${join(dir, `${machine.id}.ctl`)}`,
					'-o',
					'ControlPersist=300'
				],
				machine.target,
				[command]
			),
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
