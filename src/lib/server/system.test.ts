import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionName } from './herdr';
import {
	jobUnit,
	markSessions,
	outdatedProcesses,
	parseCommands,
	serverProcesses,
	runArgv,
	runSupervised,
	startArgv,
	startJob,
	unitServes
} from './system';

describe('parseCommands', () => {
	it('reads a valid file and defaults confirm to true', () => {
		const { commands, error } = parseCommands({
			commands: [
				{ id: 'update-claude', label: 'Update Claude', argv: ['claude', 'update'] },
				{ id: 'disk', argv: ['df', '-h'], confirm: false }
			]
		});
		expect(error).toBeNull();
		expect(commands).toEqual([
			{ id: 'update-claude', label: 'Update Claude', argv: ['claude', 'update'], confirm: true },
			{ id: 'disk', label: 'disk', argv: ['df', '-h'], confirm: false }
		]);
	});

	it('refuses the whole file when one entry is wrong', () => {
		const { commands, error } = parseCommands({
			commands: [
				{ id: 'ok', argv: ['true'] },
				{ id: 'shell', argv: 'rm -rf ~' },
				{ id: 'Bad Id', argv: ['true'] },
				{ id: 'ok', argv: ['true'] }
			]
		});
		expect(commands).toEqual([]);
		expect(error).toContain('"shell": argv must be');
		expect(error).toContain('id must be lower-case');
		expect(error).toContain('"ok": id used twice');
	});

	it('refuses a file without a commands list', () => {
		expect(parseCommands([]).error).toMatch(/expected/);
	});
});

describe('markSessions', () => {
	it('finds bordr’s session by socket, including the unnamed default one', () => {
		const raw = {
			sessions: [
				{
					name: 'default',
					default: true,
					running: true,
					socket_path: '/h/.config/herdr/herdr.sock'
				},
				{ name: 'work', running: false, socket_path: '/h/.config/herdr/sessions/work/herdr.sock' }
			]
		};
		const sessions = markSessions(raw, '/h/.config/herdr/herdr.sock');
		expect(sessions.map((s) => [s.name, s.current, s.running])).toEqual([
			['default', true, true],
			['work', false, false]
		]);
	});
});

describe('startArgv', () => {
	it('starts the installed unit in its own manager, so bordr starts what boot starts', () => {
		expect(startArgv('default', { scope: 'user', unit: 'herdr-session@default.service' })).toEqual([
			'systemctl',
			'--user',
			'--no-ask-password',
			'start',
			'herdr-session@default.service'
		]);
		expect(startArgv('main', { scope: 'system', unit: 'herdr-session.service' })).toEqual([
			'systemctl',
			'--no-ask-password',
			'start',
			'herdr-session.service'
		]);
	});

	it('otherwise runs the server in a unit of its own that survives live handoff', () => {
		expect(startArgv('main', null, 'herdr')).toEqual([
			'systemd-run',
			'--user',
			'--collect',
			'-p',
			'ExitType=cgroup',
			'--unit=bordr-herdr-main',
			'herdr',
			'--session',
			'main',
			'server'
		]);
	});
});

describe('unitServes', () => {
	const show = (argv: string) =>
		`LoadState=loaded\nExecStart={ path=/x/herdr ; argv[]=${argv} ; ignore_errors=no ; pid=0 }`;

	it('matches the session a system unit was rendered for', () => {
		expect(unitServes(show('/x/herdr --session default server'), 'default')).toBe(true);
		expect(unitServes(show('/x/herdr --session main server'), 'default')).toBe(false);
		expect(unitServes(show('/x/herdr server'), 'default')).toBe(true);
		expect(unitServes(show('/x/herdr server'), 'main')).toBe(false);
	});

	it('refuses a unit that is not a herdr server', () => {
		expect(unitServes(show('/x/herdr --session main server stop'), 'main')).toBe(false);
		expect(unitServes('LoadState=not-found\nExecStart=', 'main')).toBe(false);
	});
});

describe('jobUnit', () => {
	it('makes a valid unit name from any action key', () => {
		expect(jobUnit('run:update-claude')).toBe('bordr-job-run-update-claude');
	});
});

describe('outdatedProcesses', () => {
	it('lists programs on an install older than latest, once per program', async () => {
		const root = await mkdtemp(join(tmpdir(), 'bordr-outdated-'));
		const installs = join(root, 'installs');
		const proc = join(root, 'proc');
		for (const v of ['1.0', '2.0']) await mkdir(join(installs, 'claude', v), { recursive: true });
		await symlink('./2.0', join(installs, 'claude', 'latest'));
		const fake = async (pid: number, ppid: number, exe: string, cwd: string, arg = '--flag') => {
			const dir = join(proc, String(pid));
			await mkdir(dir, { recursive: true });
			await symlink(exe, join(dir, 'exe'));
			await symlink(cwd, join(dir, 'cwd'));
			await writeFile(join(dir, 'cmdline'), `${exe}\0${arg}\0`);
			await writeFile(join(dir, 'stat'), `${pid} (clau de) S ${ppid} 0 0`);
		};
		await fake(2, 1, '/opt/herdr', '/', 'server'); // the herdr server
		await fake(3, 2, '/usr/bin/bash', '/work/a'); // a pane's shell
		await fake(10, 3, join(installs, 'claude', '1.0', 'claude'), '/work/a');
		await fake(11, 10, join(installs, 'claude', '1.0', 'claude'), '/work/a'); // its worker
		await fake(12, 3, join(installs, 'claude', '2.0', 'claude'), '/work/b'); // current
		await fake(14, 1, join(installs, 'claude', '1.0', 'claude'), '/work/d'); // not in a pane

		const found = await outdatedProcesses(installs, proc);
		expect(found).toEqual([
			{ tool: 'claude', version: '1.0', latest: '2.0', pid: 10, cwd: '/work/a' }
		]);
		await rm(root, { recursive: true, force: true });
	});
});

describe('serverProcesses', () => {
	it('counts only servers for that session, not clients or other sessions', async () => {
		const proc = await mkdtemp(join(tmpdir(), 'bordr-proc-'));
		const put = async (pid: number, argv: string[]) => {
			await mkdir(join(proc, String(pid)));
			await writeFile(join(proc, String(pid), 'cmdline'), argv.join('\0') + '\0');
		};
		await put(1, ['/home/u/.local/bin/herdr', 'server']); // default
		await put(2, ['herdr', '--session', 'main', 'server']);
		await put(3, ['herdr', '--session', 'main', 'server', 'stop']); // a client
		await put(4, ['systemd-run', '--user', 'herdr', '--session', 'main', 'server']);
		await put(5, ['herdr', '--session', 'other', 'server']);
		expect(await serverProcesses('default', proc)).toBe(1);
		expect(await serverProcesses('main', proc)).toBe(1);
		expect(await serverProcesses('gone', proc)).toBe(0);
		await rm(proc, { recursive: true, force: true });
	});
});

describe('sessionName', () => {
	it('names the default session, whose socket sits in no sessions dir', () => {
		expect(sessionName('/h/.config/herdr/herdr.sock')).toBe('default');
		expect(sessionName('/h/.config/herdr/sessions/main/herdr.sock')).toBe('main');
	});
});

describe('jobs', () => {
	it('captures output and exit code, and refuses a second run while one is going', async () => {
		const job = startJob('test-echo', 'echo', (j) =>
			runArgv(j, ['sh', '-c', 'echo hi; echo err >&2; exit 3'])
		);
		expect(() => startJob('test-echo', 'echo', async () => 0)).toThrow(/already running/);
		await expect.poll(() => job.done).toBe(true);
		expect(job.code).toBe(3);
		expect(job.output).toContain('hi');
		expect(job.output).toContain('err');
	});

	it('reports a missing binary instead of hanging', async () => {
		const job = startJob('test-missing', 'missing', (j) => runArgv(j, ['bordr-no-such-binary']));
		await expect.poll(() => job.done).toBe(true);
		expect(job.code).toBe(1);
		expect(job.output).toContain('ENOENT');
	});

	it.skipIf(!existsSync('/run/systemd/system'))(
		'runs a supervised job in its own unit and still reads its output and exit code',
		async () => {
			const job = startJob('test-supervised', 'supervised', (j) =>
				runSupervised(j, ['sh', '-c', 'echo from-unit; exit 4'])
			);
			await expect.poll(() => job.done, { timeout: 10_000 }).toBe(true);
			expect(job.code).toBe(4);
			expect(job.output).toContain('from-unit');
		}
	);
});
