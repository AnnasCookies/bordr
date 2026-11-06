import {
	closeSync,
	fstatSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	readlinkSync
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * herdr-core reports no session id (the TUI's `agent_session`), so bordr
 * finds the transcript from the agent's own process. Linux, this host only.
 *
 * - Claude Code writes `<config>/sessions/<pid>.json` with its `sessionId`.
 * - codex and omp keep their transcript open for appending, and their
 *   adapters take an absolute path, so the open `.jsonl` is the answer.
 * - pi opens it only to write, so it is found by folder and start time.
 * - grok, copilot and agy hold a file that names their session id; see
 *   sessionFromLinks.
 */
export function sessionForProcess(kind: string, pid: number): string {
	if (!Number.isInteger(pid) || pid <= 0) return '';
	if (kind === 'claude') {
		const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
		try {
			const record = JSON.parse(readFileSync(join(configDir, 'sessions', `${pid}.json`), 'utf8'));
			return typeof record?.sessionId === 'string' ? record.sessionId : '';
		} catch {
			return '';
		}
	}
	const roots = transcriptRoots(kind);
	const byLinks = ID_KINDS.has(kind);
	if ((!roots.length && !byLinks) || process.platform !== 'linux') return '';
	const links = openLinks(pid);
	const open = links.find((link) => isTranscript(link, roots));
	if (open) return open;
	if (byLinks) {
		// copilot's `node` launcher runs the real CLI as a child, which holds the file.
		for (const child of childPids(pid)) links.push(...openLinks(child));
		return sessionFromLinks(kind, links, sessionHomes(kind), agyLogConversation);
	}
	return kind === 'pi' ? piSessionByStart(pid, roots[0]) : '';
}

/** What a process holds open; [] when it is gone or not ours to read. */
function openLinks(pid: number): string[] {
	const links: string[] = [];
	let descriptors: string[];
	try {
		descriptors = readdirSync(`/proc/${pid}/fd`);
	} catch {
		return links;
	}
	for (const fd of descriptors) {
		try {
			links.push(readlinkSync(`/proc/${pid}/fd/${fd}`));
		} catch {
			// closed between listing and reading
		}
	}
	return links;
}

/** Direct children, from every thread's `children` list (Linux 3.5+). */
function childPids(pid: number): number[] {
	const pids: number[] = [];
	let threads: string[];
	try {
		threads = readdirSync(`/proc/${pid}/task`);
	} catch {
		return pids;
	}
	for (const tid of threads) {
		try {
			for (const word of readFileSync(`/proc/${pid}/task/${tid}/children`, 'utf8').split(/\s+/)) {
				const child = Number(word);
				if (Number.isInteger(child) && child > 0) pids.push(child);
			}
		} catch {
			// thread ended, or the kernel lacks the children file
		}
	}
	return pids;
}

/** Harnesses whose session id is read from the files they hold open. */
const ID_KINDS = new Set(['grok', 'copilot', 'agy']);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** Each harness's home, honouring the same overrides its transcript adapter does. */
function sessionHomes(kind: string): string {
	const home = homedir();
	if (kind === 'grok') return process.env.GROK_HOME ?? join(home, '.grok');
	if (kind === 'copilot') return process.env.COPILOT_HOME ?? join(home, '.copilot');
	return process.env.GEMINI_HOME ?? join(home, '.gemini');
}

/**
 * The session id from the paths a harness process holds open (`/proc/<pid>/fd`
 * targets), checked against what each one held on atlas (2026-11-06):
 *
 * - grok holds `<home>/sessions/<url-encoded cwd>/<id>/events.jsonl`.
 * - copilot holds `<home>/session-state/<id>/inuse.<pid>.hold`.
 * - agy holds nothing in its session folder, which appears only at the first
 *   prompt, but its stdout is `<home>/antigravity-cli/log/cli-<start>.log`, and
 *   that log says `Created conversation <id>`, then `Streaming conversation
 *   <id>` for the one it is showing. The last such line wins, so `/resume`
 *   and a new chat follow along.
 *
 * `home` is the harness's own folder (`~/.grok`, `~/.copilot`, `~/.gemini`).
 * `conversationIn` turns agy's log path into its conversation id ('' if none).
 */
export function sessionFromLinks(
	kind: string,
	links: string[],
	home: string,
	conversationIn: (logPath: string) => string
): string {
	const root = home.replace(/\/+$/, '');
	if (kind === 'grok') {
		const re = new RegExp(`^${escape(root)}/sessions/[^/]+/(${UUID})/`, 'i');
		for (const link of links) {
			const m = re.exec(link);
			if (m) return m[1];
		}
		return '';
	}
	if (kind === 'copilot') {
		const re = new RegExp(`^${escape(root)}/session-state/(${UUID})/inuse\\.\\d+\\.hold$`, 'i');
		for (const link of links) {
			const m = re.exec(link);
			if (m) return m[1];
		}
		return '';
	}
	if (kind === 'agy') {
		const logs = `${root}/antigravity-cli/log/`;
		const log = links.find((link) => link.startsWith(logs) && link.endsWith('.log'));
		return log ? conversationIn(log) : '';
	}
	return '';
}

/** The conversation agy last created or streamed, from its log text. */
export function agyConversation(log: string): string {
	const re = new RegExp(`\\b(?:Created|Streaming) conversation (${UUID})\\b`, 'gi');
	let last = '';
	for (const m of log.matchAll(re)) last = m[1];
	return last;
}

function escape(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * agy's log grows for the life of the process and the agent list is rebuilt
 * on every refresh, so each log is read once and then only its new bytes.
 * A line cut at a chunk edge is carried into the next read.
 */
const agyLogs = new Map<string, { offset: number; carry: string; id: string }>();
const CHUNK_BYTES = 1 << 20;

export function agyLogConversation(path: string): string {
	let fd: number | undefined;
	try {
		fd = openSync(path, 'r');
		const size = fstatSync(fd).size;
		let seen = agyLogs.get(path);
		// A smaller file is a new log under a reused name: start again.
		if (!seen || size < seen.offset) seen = { offset: 0, carry: '', id: '' };
		const buffer = Buffer.alloc(CHUNK_BYTES);
		while (seen.offset < size) {
			const length = readSync(
				fd,
				buffer,
				0,
				Math.min(CHUNK_BYTES, size - seen.offset),
				seen.offset
			);
			if (length <= 0) break;
			seen.offset += length;
			const text = seen.carry + buffer.toString('utf8', 0, length);
			const cut = text.lastIndexOf('\n') + 1;
			seen.id = agyConversation(text.slice(0, cut)) || seen.id;
			seen.carry = text.slice(cut);
		}
		agyLogs.set(path, seen);
		return seen.id;
	} catch {
		return agyLogs.get(path)?.id ?? '';
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

/** When the process started, in ms since the epoch, from /proc. */
function startedAt(pid: number): number | null {
	try {
		// Field 22 (starttime) in clock ticks since boot; the name before it may hold spaces.
		const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.split(' ');
		const ticks = Number(fields?.[19]);
		const boot = Number(/^btime (\d+)$/m.exec(readFileSync('/proc/stat', 'utf8'))?.[1]);
		// shortcut: assumes CLK_TCK is 100, as on every mainstream Linux build.
		return Number.isFinite(ticks) && Number.isFinite(boot) ? boot * 1000 + ticks * 10 : null;
	} catch {
		return null;
	}
}

/**
 * pi files a session under `--<cwd with / as ->--/<ISO start>_<id>.jsonl`, a
 * few seconds after the process starts. The first one stamped after this
 * process began is its own.
 *
 * shortcut: two pi agents started in one folder within those seconds could
 * swap; give pi a pid record (as Claude Code has) if that ever bites.
 */
export function piSessionByStart(pid: number, root: string, cwd?: string): string {
	const started = startedAt(pid);
	let folder = cwd;
	try {
		folder ??= readlinkSync(`/proc/${pid}/cwd`);
	} catch {
		return '';
	}
	if (started === null || !folder) return '';
	const dir = piSessionDir(root, folder);
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return '';
	}
	const name = pickPiSession(names, started);
	return name ? join(dir, name) : '';
}

/** pi's folder for a working directory: `--home-u-repo--` for `/home/u/repo`. */
export function piSessionDir(root: string, cwd: string): string {
	return join(root, `--${cwd.replace(/^\//, '').replace(/\//g, '-')}--`);
}

/** The first session file stamped no earlier than a second before `started` (ms). */
export function pickPiSession(names: string[], started: number): string {
	let best: { at: number; name: string } | undefined;
	for (const name of names) {
		if (!name.endsWith('.jsonl') || name.endsWith('.ctxc.jsonl')) continue;
		// 2026-11-04T14-51-30-462Z_<id>.jsonl
		const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/.exec(name);
		if (!m) continue;
		const at = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
		if (at + 1000 < started) continue;
		if (!best || at < best.at) best = { at, name };
	}
	return best?.name ?? '';
}

function transcriptRoots(kind: string): string[] {
	const home = homedir();
	if (kind === 'codex')
		return [join(process.env.CODEX_HOME ?? join(home, '.codex'), 'sessions') + '/'];
	if (kind === 'pi') return [join(home, '.pi', 'agent', 'sessions') + '/'];
	if (kind === 'omp') return [join(home, '.omp', 'agent', 'sessions') + '/'];
	return [];
}

export function isTranscript(path: string, roots: string[]): boolean {
	return (
		roots.some((root) => path.startsWith(root)) &&
		path.endsWith('.jsonl') &&
		!path.endsWith('.ctxc.jsonl') &&
		!path.endsWith('/__advisor.jsonl')
	);
}
