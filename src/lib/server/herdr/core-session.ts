import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
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
	if (!roots.length || process.platform !== 'linux') return '';
	let descriptors: string[];
	try {
		descriptors = readdirSync(`/proc/${pid}/fd`);
	} catch {
		return '';
	}
	for (const fd of descriptors) {
		let target: string;
		try {
			target = readlinkSync(`/proc/${pid}/fd/${fd}`);
		} catch {
			continue; // closed between listing and reading
		}
		if (isTranscript(target, roots)) return target;
	}
	return kind === 'pi' ? piSessionByStart(pid, roots[0]) : '';
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
