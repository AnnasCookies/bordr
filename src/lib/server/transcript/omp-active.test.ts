import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { activeOmpTranscript } from './omp-active';

describe('activeOmpTranscript', () => {
	it.skipIf(process.platform !== 'linux')('uses only the root OMP process session', () => {
		const root = mkdtempSync(join(tmpdir(), 'bordr-omp-fd-'));
		const sessions = join(root, '.omp', 'agent', 'sessions', '-repo');
		const path = join(sessions, 'session.jsonl');
		mkdirSync(sessions, { recursive: true });
		writeFileSync(path, '{"type":"session"}\n');
		const descriptor = openSync(path, 'r');
		const omp = { pid: process.pid, name: 'omp' };

		try {
			expect(activeOmpTranscript({ shell_pid: process.ppid, foreground_processes: [omp] })).toBe(
				path
			);
			expect(
				activeOmpTranscript({ shell_pid: process.pid, foreground_processes: [omp] })
			).toBeNull();
		} finally {
			closeSync(descriptor);
			rmSync(root, { recursive: true, force: true });
		}
	});
});
