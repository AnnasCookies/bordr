import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { env } from '$env/dynamic/private';
import { getClient, listAgents } from './herdr';
import { HerdrHangupError } from './herdr/client';
import { sendToAll } from './push';
import { DATA_DIR } from './state-store';

/**
 * Housekeeping for the host: herdr's own server and sessions, plus whatever
 * commands the operator has listed for the phone to run.
 *
 * bordr can already run anything through an agent, so a command runner does
 * not widen what a visitor can do. What it must not do is let the PHONE decide
 * what runs. Every argv here comes from bordr's own code or from a file edited
 * at a terminal on this host — the same rule as herdr's machine list — and the
 * request only ever names one of them. There is no shell and no free text.
 */

/** One entry from the operator's commands file. */
export interface UserCommand {
	id: string;
	label: string;
	argv: string[];
	/** Ask before running. Defaults to true: an update is not a thing to fat-finger. */
	confirm: boolean;
}

export interface CommandsFile {
	path: string;
	commands: UserCommand[];
	/** Why the file was not used, when it exists but is wrong. */
	error: string | null;
}

export function commandsPath(): string {
	if (env.BORDR_COMMANDS) return env.BORDR_COMMANDS;
	const config = env.XDG_CONFIG_HOME || join(homedir(), '.config');
	return join(config, 'bordr', 'commands.json');
}

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * Validate the parsed file. Everything wrong is reported at once, and one bad
 * entry refuses the whole file: half a list that silently dropped "update
 * claude" reads as if that command had never been written.
 */
export function parseCommands(raw: unknown): { commands: UserCommand[]; error: string | null } {
	const list = (raw as { commands?: unknown } | null)?.commands;
	if (!Array.isArray(list)) return { commands: [], error: 'expected { "commands": [ … ] }' };
	const problems: string[] = [];
	const seen = new Set<string>();
	const commands: UserCommand[] = [];
	list.forEach((entry, i) => {
		const e = (entry ?? {}) as Record<string, unknown>;
		const where = typeof e.id === 'string' ? `"${e.id}"` : `entry ${i + 1}`;
		if (typeof e.id !== 'string' || !ID.test(e.id)) {
			problems.push(`${where}: id must be lower-case letters, digits and dashes`);
			return;
		}
		if (seen.has(e.id)) problems.push(`${where}: id used twice`);
		seen.add(e.id);
		if (
			!Array.isArray(e.argv) ||
			e.argv.length === 0 ||
			!e.argv.every((a) => typeof a === 'string') ||
			!e.argv[0]
		) {
			problems.push(`${where}: argv must be a non-empty list of strings`);
			return;
		}
		commands.push({
			id: e.id,
			label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : e.id,
			argv: e.argv as string[],
			confirm: e.confirm !== false
		});
	});
	return problems.length ? { commands: [], error: problems.join('; ') } : { commands, error: null };
}

/**
 * Read fresh on every call, so an edit at the terminal shows up on the next
 * refresh without restarting bordr. It is one small file.
 *
 * Refused when anyone but its owner can write to it: whoever can edit this
 * file chooses what the phone runs.
 */
export async function loadCommands(): Promise<CommandsFile> {
	const path = commandsPath();
	let text: string;
	try {
		const info = await stat(path);
		if (info.mode & 0o022) {
			return { path, commands: [], error: 'group or others can write to it; chmod go-w it' };
		}
		text = await readFile(path, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { path, commands: [], error: null };
		return { path, commands: [], error: e instanceof Error ? e.message : String(e) };
	}
	try {
		return { path, ...parseCommands(JSON.parse(text)) };
	} catch (e) {
		return { path, commands: [], error: `not valid JSON: ${(e as Error).message}` };
	}
}

// --- jobs -----------------------------------------------------------------

export interface Job {
	id: string;
	/** The action key, so the page can show which button is busy. */
	action: string;
	label: string;
	startedAt: number;
	output: string;
	done: boolean;
	/** Exit code; null while running, or when killed by a signal. */
	code: number | null;
}

/**
 * ponytail: the list is in memory, the last 20, gone on restart. A supervised
 * command keeps running and keeps its log under BORDR_DATA_DIR/jobs; it just
 * drops off this list. Persist the list if that ever matters.
 */
const jobs = new Map<string, Job>();
const KEEP = 20;
const OUTPUT_CAP = 200_000;
/** Long enough for a slow npm install; a hung command still ends. */
const TIMEOUT_MS = 15 * 60_000;
/** Shorter runs finish while you are still looking at the page. */
const NOTIFY_AFTER_MS = 20_000;

export function listJobs(): Job[] {
	return [...jobs.values()].reverse();
}

function append(job: Job, text: string) {
	job.output += text;
	if (job.output.length > OUTPUT_CAP) job.output = '…\n' + job.output.slice(-OUTPUT_CAP);
}

function logPath(job: Job): string {
	return join(DATA_DIR, 'jobs', `${job.id}.log`);
}

/** Tell the phone a long run has finished, so nobody has to watch a spinner. */
function notifyFinished(job: Job) {
	if (Date.now() - job.startedAt < NOTIFY_AFTER_MS) return;
	void sendToAll(
		{
			title: `${job.label} ${job.code === 0 ? 'finished' : 'failed'}`,
			body: job.code === 0 ? 'Tap to see the output.' : `Exit ${job.code ?? '?'} — tap to see why.`,
			url: '/settings/system'
		},
		3600
	).catch(() => {});
}

/**
 * Start a job and return at once. Jobs rather than one long request because
 * the adapter drops a connection idle for IDLE_TIMEOUT (120s), and a quiet
 * update easily outlasts that; the page polls instead.
 *
 * The same action cannot run twice at once — a double tap on "update" should
 * not start two installers racing over one directory.
 */
export function startJob(action: string, label: string, work: (job: Job) => Promise<number>): Job {
	for (const j of jobs.values()) {
		if (j.action === action && !j.done) throw new Error(`${label} is already running`);
	}
	const job: Job = {
		id: crypto.randomUUID(),
		action,
		label,
		startedAt: Date.now(),
		output: '',
		done: false,
		code: null
	};
	jobs.set(job.id, job);
	while (jobs.size > KEEP) {
		const oldest = [...jobs.values()].find((j) => j.done);
		if (!oldest) break;
		jobs.delete(oldest.id);
		void rm(logPath(oldest), { force: true });
	}
	work(job)
		.then(
			(code) => {
				job.code = code;
			},
			(e) => {
				append(
					job,
					`${job.output && !job.output.endsWith('\n') ? '\n' : ''}${e instanceof Error ? e.message : e}\n`
				);
				job.code = job.code ?? 1;
			}
		)
		.finally(() => {
			job.done = true;
			notifyFinished(job);
		});
	return job;
}

/**
 * Run argv as bordr's child, stdout and stderr interleaved into the job.
 *
 * Not killed when the phone goes away: an installer stopped halfway is worse
 * than one that finishes with nobody watching.
 */
export function runArgv(job: Job, argv: string[]): Promise<number> {
	const { promise, resolve, reject } = Promise.withResolvers<number>();
	const child = spawn(argv[0], argv.slice(1), {
		cwd: homedir(),
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: TIMEOUT_MS,
		env: CHILD_ENV
	});
	child.stdout.setEncoding('utf8').on('data', (s: string) => append(job, s));
	child.stderr.setEncoding('utf8').on('data', (s: string) => append(job, s));
	child.on('error', reject);
	child.on('close', (code, signal) => {
		if (signal) append(job, `\nstopped by ${signal}\n`);
		resolve(code ?? 1);
	});
	return promise;
}

/**
 * The user manager's runtime dir. A system-level bordr unit (deploy/system)
 * runs with no login session, so XDG_RUNTIME_DIR is unset and every
 * `systemctl --user` would fail to find the bus; linger keeps the manager at
 * this path regardless.
 */
const RUNTIME_DIR = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`;
const CHILD_ENV = { ...process.env, XDG_RUNTIME_DIR: RUNTIME_DIR };

/** A per-user systemd manager is running (`--user` calls will work). */
const hasUserManager = existsSync(join(RUNTIME_DIR, 'systemd', 'private'));

/** A systemd unit name for a job, so the same action twice is refused by systemd too. */
export function jobUnit(action: string): string {
	return `bordr-job-${action.replace(/[^A-Za-z0-9-]/g, '-')}`;
}

/**
 * Run argv in a systemd unit of its own, where bordr can find it.
 *
 * As bordr's child, a job dies with bordr: `systemctl restart bordr` kills the
 * whole cgroup, so an update that bordr is itself caught up in is cut off
 * halfway. In its own unit it finishes regardless and writes to a log file;
 * bordr only tails that file. Without systemd it falls back to a plain child.
 */
export async function runSupervised(job: Job, argv: string[]): Promise<number> {
	if (!hasUserManager) return runArgv(job, argv);
	const log = logPath(job);
	await mkdir(dirname(log), { recursive: true });
	await writeFile(log, '', { mode: 0o600 });
	let offset = 0;
	const drain = async () => {
		const text = await readFile(log, 'utf8').catch(() => '');
		if (text.length > offset) append(job, text.slice(offset));
		offset = text.length;
	};
	const timer = setInterval(drain, 500);
	try {
		const code = await runArgv({ ...job, output: '' }, [
			'systemd-run',
			'--user',
			'--wait',
			'--collect',
			'--quiet',
			`--unit=${jobUnit(job.action)}`,
			`-p`,
			`StandardOutput=append:${log}`,
			`-p`,
			`StandardError=append:${log}`,
			`-p`,
			`WorkingDirectory=${homedir()}`,
			`-p`,
			`RuntimeMaxSec=${TIMEOUT_MS / 1000}`,
			'--',
			...argv
		]);
		await drain();
		// 203/EXEC: systemd could not start it at all, and says so only in the journal.
		if (code === 203) append(job, `could not run ${argv[0]}: not found or not executable\n`);
		return code;
	} finally {
		clearInterval(timer);
	}
}

// --- herdr ----------------------------------------------------------------

function herdrBin(): string {
	return env.HERDR_BIN?.trim() || 'herdr';
}

export interface HerdrSession {
	name: string;
	running: boolean;
	default: boolean;
	/** The session bordr is connected to. */
	current: boolean;
}

/** Collect a short command's stdout, for reads rather than jobs. */
function capture(argv: string[]): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const child = spawn(argv[0], argv.slice(1), {
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 10_000,
		env: CHILD_ENV
	});
	let out = '';
	let err = '';
	child.stdout.setEncoding('utf8').on('data', (s: string) => (out += s));
	child.stderr.setEncoding('utf8').on('data', (s: string) => (err += s));
	child.on('error', reject);
	child.on('close', (code) =>
		code === 0 ? resolve(out) : reject(new Error(err.trim() || `exit ${code}`))
	);
	return promise;
}

/**
 * Which session is bordr's is decided by socket path, not by name: the
 * default session's socket is `~/.config/herdr/herdr.sock`, which carries no
 * name at all.
 */
export function markSessions(raw: unknown, socket: string): HerdrSession[] {
	const list = (raw as { sessions?: unknown[] } | null)?.sessions ?? [];
	return list.map((s) => {
		const r = (s ?? {}) as Record<string, unknown>;
		return {
			name: String(r.name ?? ''),
			running: r.running === true,
			default: r.default === true,
			current: r.socket_path === socket
		};
	});
}

export async function listSessions(): Promise<HerdrSession[]> {
	const out = await capture([herdrBin(), 'session', 'list', '--json']);
	return markSessions(JSON.parse(out), getClient().socketPath);
}

/**
 * A name from the phone is only used if herdr listed it. It goes to herdr as
 * one argv entry either way, but "stop the session called --help" should not
 * even be attempted.
 */
async function known(name: string): Promise<HerdrSession> {
	const session = (await listSessions()).find((s) => s.name === name);
	if (!session) throw new Error(`no herdr session called "${name}"`);
	return session;
}

async function current(): Promise<HerdrSession> {
	const session = (await listSessions()).find((s) => s.current);
	if (!session) throw new Error(`herdr lists no session on ${getClient().socketPath}`);
	return session;
}

/**
 * The unit that runs a session's server, in whichever manager the operator
 * chose to install it: `deploy/user/herdr-session@<name>.service`, or the
 * rendered `deploy/system/herdr-session.service`. Both are supported and
 * bordr follows whichever serves its session.
 */
export interface HerdrUnit {
	scope: 'user' | 'system';
	unit: string;
}

/** `systemctl` arguments that address the unit's own manager. */
export function systemctl(unit: HerdrUnit, verb: string): string[] {
	// A missing polkit rule should fail at once with a reason, not wait on a
	// password prompt nobody can see.
	const scope = unit.scope === 'user' ? ['--user'] : [];
	return ['systemctl', ...scope, '--no-ask-password', verb, unit.unit];
}

/**
 * Whether a unit's ExecStart runs this session's server. `systemctl show`
 * prints it as `{ path=… ; argv[]=/…/herdr --session main server ; … }`. The
 * system unit has one fixed name, so without this a unit rendered for
 * `main` would be taken for a bordr following `default`.
 */
export function unitServes(execStart: string, name: string): boolean {
	const argv = /argv\[\]=([^;]*)/.exec(execStart)?.[1].trim().split(/\s+/) ?? [];
	if (basename(argv[0] ?? '') !== 'herdr' || argv.at(-1) !== 'server') return false;
	const at = argv.indexOf('--session');
	return at === -1 ? name === 'default' : argv[at + 1] === name;
}

/**
 * Find the session's unit. System first: it is the one upstream recommends,
 * and a user unit left behind beside it is the mistake the installer warns
 * about, not a choice. No unit at all is fine — Start falls back to a one-off
 * `systemd-run` unit in the user manager.
 */
export async function findUnit(name: string): Promise<HerdrUnit | null> {
	const system = await capture([
		'systemctl',
		'show',
		'herdr-session.service',
		'-p',
		'LoadState',
		'-p',
		'ExecStart'
	]).catch(() => '');
	if (/^LoadState=loaded$/m.test(system) && unitServes(system, name)) {
		return { scope: 'system', unit: 'herdr-session.service' };
	}
	if (!hasUserManager) return null;
	const user = `herdr-session@${name}.service`;
	const found = await capture(['systemctl', '--user', 'cat', user]).then(
		() => true,
		() => false
	);
	return found ? { scope: 'user', unit: user } : null;
}

/**
 * The argv that starts a session's server outside bordr.
 *
 * Not a child of bordr: under systemd, bordr's unit kills its whole cgroup on
 * restart, and every agent in the session would go with it. The installed
 * unit is used when there is one, so the server bordr starts is the same one
 * boot starts. A system unit needs the polkit rule the system installer adds,
 * or `systemctl start` is refused for want of a password. With no unit,
 * `systemd-run` gives the server one of its own; naming it means a second tap
 * is refused by systemd.
 *
 * `ExitType=cgroup` is what lets live handoff work under systemd: the old
 * server hands its panes to a new process and exits, and without it systemd
 * reads that exit as the service ending and kills the new server — every
 * agent with it. Measured on herdr 0.9.1.
 */
export function startArgv(name: string, unit: HerdrUnit | null, bin = herdrBin()): string[] {
	if (unit) return systemctl(unit, 'start');
	return [
		'systemd-run',
		'--user',
		'--collect',
		'-p',
		'ExitType=cgroup',
		`--unit=bordr-herdr-${name}`,
		bin,
		'--session',
		name,
		'server'
	];
}

// --- outdated harnesses -----------------------------------------------------

export interface Outdated {
	tool: string;
	version: string;
	latest: string;
	pid: number;
	cwd: string;
}

/**
 * Agents in herdr's panes still running an install older than the current one.
 *
 * An update reaches new agents only: a running one keeps the binary it was
 * started with until you restart it. This says which ones those are.
 *
 * ponytail: mise-shaped on Linux — `<mise>/installs/<tool>/<version>/…` with a
 * `latest` symlink beside the versions, found through /proc. Anything else
 * (npm -g, brew, macOS) shows nothing rather than guessing. Another installer
 * would need its own "which version is current" rule.
 */
export async function outdatedProcesses(
	installs = join(env.MISE_DATA_DIR || join(homedir(), '.local', 'share', 'mise'), 'installs'),
	proc = '/proc'
): Promise<Outdated[]> {
	const prefix = installs.replace(/\/+$/, '') + '/';
	const latestOf = new Map<string, string | null>();
	const latest = async (tool: string) => {
		if (!latestOf.has(tool)) {
			const target = await readlink(join(installs, tool, 'latest')).catch(() => null);
			latestOf.set(tool, target ? basename(target) : null);
		}
		return latestOf.get(tool);
	};

	interface Proc {
		pid: number;
		ppid: number;
		paths: string[];
		herdrServer: boolean;
	}
	const procs = new Map<number, Proc>();
	const pids = (await readdir(proc).catch(() => [])).filter((d) => /^\d+$/.test(d));
	await Promise.all(
		pids.map(async (pid) => {
			try {
				const stat = await readFile(join(proc, pid, 'stat'), 'utf8');
				// Field 4, after the parenthesised name, which may itself hold spaces.
				const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
				const argv = (await readFile(join(proc, pid, 'cmdline'), 'utf8')).split('\0');
				const exe = await readlink(join(proc, pid, 'exe')).catch(() => '');
				procs.set(Number(pid), {
					pid: Number(pid),
					ppid,
					paths: [exe, argv[0], argv[1] ?? ''],
					herdrServer: basename(argv[0]) === 'herdr' && argv.includes('server')
				});
			} catch {
				// Gone between readdir and read, or not ours to read.
			}
		})
	);

	const installOf = (p: Proc) => p.paths.find((x) => x.startsWith(prefix));

	/**
	 * The agent is the topmost installed program under a herdr pane. Below it
	 * sit its own workers and MCP servers — often an older node — which are
	 * not something to restart by hand; beside it, outside herdr, sit browser
	 * helpers and daemons bordr neither shows nor controls. Both only buried
	 * the agents.
	 */
	const isAgent = (p: Proc) => {
		for (let up = procs.get(p.ppid), hops = 0; up && hops < 64; up = procs.get(up.ppid), hops++) {
			if (installOf(up)) return false;
			if (up.herdrServer) return true;
		}
		return false;
	};

	const found: Outdated[] = [];
	for (const p of procs.values()) {
		const path = installOf(p);
		if (!path || !isAgent(p)) continue;
		const [tool, version] = path.slice(prefix.length).split('/');
		const current = await latest(tool);
		if (!current || version === current || version === 'latest') continue;
		const cwd = await readlink(join(proc, String(p.pid), 'cwd')).catch(() => '');
		found.push({ tool, version, latest: current, pid: p.pid, cwd });
	}
	return found.sort((a, b) => a.tool.localeCompare(b.tool) || a.pid - b.pid);
}

// --- update everything ------------------------------------------------------

/** The commands-file entry "Update everything" runs for the harnesses. */
export const UPDATE_ALL_COMMAND = 'update-harnesses';

/**
 * herdr servers for a session, read from /proc. `herdr --session <name> server`,
 * or a bare `herdr server` for the default session — and not `server stop`,
 * which is a client asking one to stop.
 */
export async function serverProcesses(name: string, proc = '/proc'): Promise<number> {
	const pids = (await readdir(proc).catch(() => [])).filter((d) => /^\d+$/.test(d));
	const argvs = await Promise.all(
		pids.map((pid) =>
			readFile(join(proc, pid, 'cmdline'), 'utf8').then(
				(t) => t.split('\0').filter(Boolean),
				() => [] as string[]
			)
		)
	);
	return argvs.filter((argv) => {
		if (basename(argv[0] ?? '') !== 'herdr' || argv.at(-1) !== 'server') return false;
		const at = argv.indexOf('--session');
		return at === -1 ? name === 'default' : argv[at + 1] === name;
	}).length;
}

/**
 * Ask herdr to stop or hand off. A server on its way out may close the socket
 * instead of answering — that is the request working, not failing, and
 * treating it as a failure would skip the start that brings the agents back.
 * Whether it really went is judged afterwards, by process, not by this reply.
 */
async function goingAway(method: 'server.stop' | 'server.live_handoff'): Promise<void> {
	try {
		await getClient().request(method, {});
	} catch (e) {
		if (!(e instanceof HerdrHangupError)) throw e;
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `done` answers true or the budget runs out. */
async function until(done: () => Promise<boolean>, budgetMs: number, everyMs = 500) {
	const end = Date.now() + budgetMs;
	while (!(await done().catch(() => false))) {
		if (Date.now() >= end) return false;
		await sleep(everyMs);
	}
	return true;
}

/**
 * Stopped means gone, not just quiet. herdr drops its socket first — so
 * `session list` says "stopped" — and then still has panes to end and state
 * to write. Updating under a server that is still exiting is what this waits
 * out.
 */
async function serverGone(name: string): Promise<boolean> {
	const listed = (await listSessions()).find((s) => s.name === name);
	return !listed?.running && (await serverProcesses(name)) === 0;
}

async function unitActive(unit: HerdrUnit): Promise<boolean> {
	const state = await capture(systemctl(unit, 'is-active')).catch((e: Error) => e.message);
	return /^(active|activating|deactivating|reloading)$/m.test(state.trim());
}

/** Up means the socket answers, not that a process exists. */
async function isUp(): Promise<boolean> {
	await getClient().request('ping');
	return true;
}

const STOP_BUDGET_MS = 60_000;
const START_BUDGET_MS = 30_000;
/** Agents resume one by one after start; this is how long to wait for the last. */
const RESUME_BUDGET_MS = 90_000;

/**
 * The terminal routine in one go: stop herdr, update herdr, update the
 * harnesses, start herdr. Stopping is what puts agents on the new harness
 * versions; herdr saves every pane on stop and resumes the agents into their
 * conversations on start.
 *
 * Each step waits for the last to have really finished: stopped means no
 * server process and an inactive unit, started means the socket answers, and
 * then it waits for the agents to come back and says how many did.
 *
 * The first failing update stops the updates, but herdr is ALWAYS started
 * again: a failed npm install must not leave every agent down with nobody at
 * a terminal to notice. If herdr never stops, nothing is updated or started.
 *
 * ponytail: the sequence runs inside bordr. If bordr itself restarts
 * mid-way, herdr stays stopped until Start is pressed. Move the whole chain
 * into one systemd unit if that ever bites.
 */
async function updateEverything(
	job: Job,
	session: HerdrSession,
	harnesses: string[] | null,
	unit: HerdrUnit | null,
	bin: string
): Promise<number> {
	const t0 = Date.now();
	const step = (text: string) =>
		append(
			job,
			`${job.output && !job.output.endsWith('\n') ? '\n' : ''}== [${Math.round((Date.now() - t0) / 1000)}s] ${text}\n`
		);
	const agentsBefore = session.running ? (await listAgents().catch(() => [])).length : 0;

	if (session.running) {
		step(`stopping herdr (${agentsBefore} agents)`);
		await goingAway('server.stop');
	}
	// A server that will not go is left alone: nothing updated, nothing started.
	if (!(await until(() => serverGone(session.name), STOP_BUDGET_MS))) {
		throw new Error(`herdr did not stop within ${STOP_BUDGET_MS / 1000}s; nothing was updated`);
	}
	// With ExitType=cgroup the unit stays up while any pane process lingers.
	// Once the server itself is gone those are orphans: give them a moment,
	// then let systemd end them, or the start below would find the unit busy.
	if (unit && !(await until(async () => !(await unitActive(unit)), 15_000))) {
		step('ending processes left in the herdr unit');
		await capture(systemctl(unit, 'stop'));
	}
	step('herdr stopped');

	let code: number;
	try {
		step('updating herdr');
		code = await runSupervised(job, [bin, 'update']);
		if (code === 0 && harnesses) {
			step('updating harnesses');
			code = await runSupervised(job, harnesses);
		} else if (!harnesses) {
			step(`no "${UPDATE_ALL_COMMAND}" in the commands file; harnesses skipped`);
		}
		if (code !== 0) step(`update failed (exit ${code}); starting herdr anyway`);
	} finally {
		step('starting herdr');
		const started = await runArgv(job, startArgv(session.name, unit));
		if (started !== 0) code = started;
		else if (!(await until(isUp, START_BUDGET_MS))) {
			step(`herdr did not answer within ${START_BUDGET_MS / 1000}s; check it from a terminal`);
			code = 1;
		} else {
			step('herdr is up; waiting for agents to resume');
			let back = 0;
			await until(
				async () => {
					back = (await listAgents()).length;
					return back >= agentsBefore;
				},
				RESUME_BUDGET_MS,
				2000
			);
			step(
				back >= agentsBefore
					? `${back} agents back`
					: `${back} of ${agentsBefore} agents back after ${RESUME_BUDGET_MS / 1000}s; start the rest by hand`
			);
		}
	}
	return code;
}

// --- actions ----------------------------------------------------------------

export type Action =
	| 'reload-config'
	| 'restart-server'
	| 'stop-server'
	| 'start-server'
	| 'update-herdr'
	| 'stop-session'
	| 'delete-session'
	| 'update-all'
	| 'run';

/** Start one action as a job. `name` is a session name or a command id. */
export async function runAction(action: Action, name: string): Promise<Job> {
	const bin = herdrBin();
	switch (action) {
		case 'reload-config':
			return startJob(action, 'Reload herdr config', async (job) => {
				await getClient().request('server.reload_config', {});
				append(job, 'config reloaded\n');
				return 0;
			});
		case 'restart-server':
			// Live handoff: a new server process takes over every pane, so the
			// agents keep running. It picks up whatever herdr binary is installed
			// now, which is how an update is applied without losing anything.
			return startJob(action, 'Restart herdr (live handoff)', async (job) => {
				await goingAway('server.live_handoff');
				append(job, 'handed off to a new herdr server; agents kept running\n');
				return 0;
			});
		case 'stop-server': {
			const session = await current();
			if (!session.running) throw new Error(`herdr session "${session.name}" is already stopped`);
			return startJob(action, 'Stop herdr server', async (job) => {
				await goingAway('server.stop');
				append(
					job,
					'herdr is stopping; bordr will show it as unreachable until it is started again\n'
				);
				return 0;
			});
		}
		case 'start-server': {
			const session = await current();
			if (session.running) throw new Error(`herdr session "${session.name}" is already running`);
			const unit = await findUnit(session.name);
			return startJob(action, 'Start herdr server', (job) =>
				runArgv(job, startArgv(session.name, unit))
			);
		}
		case 'update-herdr':
			return startJob(action, 'Update herdr', (job) => runSupervised(job, [bin, 'update']));
		case 'update-all': {
			const session = await current();
			const file = await loadCommands();
			if (file.error) throw new Error(`${file.path}: ${file.error}`);
			const harnesses = file.commands.find((c) => c.id === UPDATE_ALL_COMMAND);
			const unit = await findUnit(session.name);
			return startJob(action, 'Update everything', (job) =>
				updateEverything(job, session, harnesses?.argv ?? null, unit, bin)
			);
		}
		case 'stop-session': {
			const session = await known(name);
			return startJob(`${action}:${name}`, `Stop session ${name}`, (job) =>
				runArgv(job, [bin, 'session', 'stop', session.name])
			);
		}
		case 'delete-session': {
			const session = await known(name);
			if (session.running) throw new Error(`stop "${name}" before deleting it`);
			return startJob(`${action}:${name}`, `Delete session ${name}`, (job) =>
				runArgv(job, [bin, 'session', 'delete', session.name])
			);
		}
		case 'run': {
			const file = await loadCommands();
			if (file.error) throw new Error(`${file.path}: ${file.error}`);
			const command = file.commands.find((c) => c.id === name);
			if (!command) throw new Error(`no command "${name}" in ${file.path}`);
			return startJob(`run:${command.id}`, command.label, (job) =>
				runSupervised(job, command.argv)
			);
		}
	}
}

export const ACTIONS: Action[] = [
	'reload-config',
	'restart-server',
	'stop-server',
	'start-server',
	'update-herdr',
	'stop-session',
	'delete-session',
	'update-all',
	'run'
];
