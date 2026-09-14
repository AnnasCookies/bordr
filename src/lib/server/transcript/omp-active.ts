import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { basename } from 'node:path';

export interface ForegroundProcess {
	pid?: unknown;
	name?: unknown;
	argv?: unknown;
}

export interface PaneProcessInfo {
	shell_pid?: unknown;
	foreground_processes?: ForegroundProcess[];
}

function parentPid(pid: number): number | null {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
		const match = /^\d+ \(.*\) \S (\d+) /.exec(stat);
		return match ? Number(match[1]) : null;
	} catch {
		return null;
	}
}

function isOmpSessionTranscript(path: string): boolean {
	const name = basename(path);
	return (
		path.includes('/.omp/agent/sessions/') &&
		name.endsWith('.jsonl') &&
		!name.endsWith('.ctxc.jsonl') &&
		name !== '__advisor.jsonl'
	);
}

/**
 * Return the session file held open by this pane's root OMP process.
 *
 * The root must be a direct child of Herdr's pane shell. Nested OMP probes
 * inherit HERDR_PANE_ID, but their different parent keeps their chats out.
 */
export function activeOmpTranscript(processInfo: PaneProcessInfo | undefined): string | null {
	if (process.platform !== 'linux' || !processInfo) return null;
	const shellPid = Number(processInfo.shell_pid);
	if (!Number.isInteger(shellPid) || shellPid <= 0) return null;

	for (const foreground of processInfo.foreground_processes ?? []) {
		const executable = Array.isArray(foreground.argv) ? foreground.argv[0] : undefined;
		const isOmp =
			foreground.name === 'omp' ||
			(typeof executable === 'string' && basename(executable) === 'omp');
		const pid = Number(foreground.pid);
		if (!isOmp || !Number.isInteger(pid) || pid <= 0 || parentPid(pid) !== shellPid) continue;

		const fdDirectory = `/proc/${pid}/fd`;
		let descriptors: string[];
		try {
			descriptors = readdirSync(fdDirectory);
		} catch {
			return null;
		}
		for (const descriptor of descriptors) {
			try {
				const target = readlinkSync(`${fdDirectory}/${descriptor}`);
				if (isOmpSessionTranscript(target)) return target;
			} catch {
				// Descriptors can close between listing and reading them.
			}
		}
	}
	return null;
}
