import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Every ssh spawned, and a child that does nothing until told to. */
const ssh = vi.hoisted(() => ({
	spawned: [] as Array<{ args: string[]; child: FakeChild }>
}));

interface FakeChild extends EventEmitter {
	stdout: EventEmitter;
	stderr: EventEmitter;
	kill: ReturnType<typeof vi.fn>;
}

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	return {
		...actual,
		spawn: vi.fn((_command: string, args: string[]) => {
			const child = Object.assign(new EventEmitter(), {
				stdout: new EventEmitter(),
				stderr: new EventEmitter(),
				kill: vi.fn(() => true)
			}) as FakeChild;
			ssh.spawned.push({ args, child });
			return child;
		})
	};
});

const policy = vi.hoisted(() => ({
	machines: [{ id: 'a', label: 'tm-dev', target: 'tm-dev', session: 'default', enabled: true }]
}));
vi.mock('./machines', () => ({ listMachines: () => policy.machines }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));

const saved = {
	runtime: process.env.XDG_RUNTIME_DIR,
	data: process.env.BORDR_DATA_DIR,
	port: process.env.PORT
};
let base: string;

beforeEach(() => {
	ssh.spawned.length = 0;
	base = mkdtempSync(join(tmpdir(), 'bordr-runtime-'));
	process.env.XDG_RUNTIME_DIR = base;
});

afterEach(() => {
	vi.useRealTimers();
	rmSync(base, { recursive: true, force: true });
	for (const [key, value] of [
		['XDG_RUNTIME_DIR', saved.runtime],
		['BORDR_DATA_DIR', saved.data],
		['PORT', saved.port]
	] as const) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

const MACHINE = {
	id: 'a',
	label: 'tm-dev',
	target: 'tm-dev',
	session: 'default',
	enabled: true
};

describe('runtimeDir', () => {
	/**
	 * This host runs `bordr` and `bordr-dulce` as the same user. A shared
	 * directory let one instance's connect delete the socket, and cancel the
	 * forward, that the other was using.
	 */
	it('gives each instance its own directory', async () => {
		const { runtimeDir } = await import('./connections');
		process.env.BORDR_DATA_DIR = '/srv/bordr/.data';
		process.env.PORT = '5173';
		const first = runtimeDir();
		process.env.BORDR_DATA_DIR = '/srv/bordr-dulce/.data';
		process.env.PORT = '5174';
		const second = runtimeDir();
		expect(first).not.toBe(second);
		expect(first.startsWith(join(base, 'bordr-machines'))).toBe(true);
		// The same instance finds the same directory again after a restart.
		process.env.BORDR_DATA_DIR = '/srv/bordr/.data';
		process.env.PORT = '5173';
		expect(runtimeDir()).toBe(first);
	});

	it('keeps the directories private to this user', async () => {
		const { runtimeDir } = await import('./connections');
		const dir = runtimeDir();
		expect(statSync(dir).mode & 0o777).toBe(0o700);
		expect(statSync(join(base, 'bordr-machines')).mode & 0o777).toBe(0o700);
	});

	it('tightens a directory of its own that has been loosened', async () => {
		const { runtimeDir } = await import('./connections');
		const dir = runtimeDir();
		chmodSync(dir, 0o755);
		expect(runtimeDir()).toBe(dir);
		expect(statSync(dir).mode & 0o777).toBe(0o700);
	});

	/** A link could point the control sockets somewhere another user can reach. */
	it('refuses a symlink where its directory should be', async () => {
		const { runtimeDir } = await import('./connections');
		const dir = runtimeDir();
		rmSync(dir, { recursive: true });
		const elsewhere = mkdtempSync(join(tmpdir(), 'bordr-elsewhere-'));
		try {
			symlinkSync(elsewhere, dir);
			expect(() => runtimeDir()).toThrow(/not a directory/);
		} finally {
			rmSync(elsewhere, { recursive: true, force: true });
		}
	});
});

describe('ssh arguments', () => {
	/** A target of `-oProxyCommand=…` must stay a host name, never an option. */
	it('puts the target after --, then the command', async () => {
		const { sshArgs } = await import('./connections');
		expect(sshArgs(['-o', 'BatchMode=yes'], '-oProxyCommand=touch /tmp/x', ['uptime'])).toEqual([
			'-o',
			'BatchMode=yes',
			'--',
			'-oProxyCommand=touch /tmp/x',
			'uptime'
		]);
	});

	it('runs a remote command with the target after --', async () => {
		const { runOn } = await import('./connections');
		const pending = runOn(MACHINE, 'echo hi');
		const { args, child } = ssh.spawned[0];
		const at = args.indexOf('--');
		expect(at).toBeGreaterThan(-1);
		expect(args.slice(at)).toEqual(['--', 'tm-dev', 'echo hi']);
		child.stdout.emit('data', Buffer.from('hi\n'));
		child.emit('exit', 0);
		expect(await pending).toBe('hi\n');
	});
});

describe('cancelForward', () => {
	function controlFile(): string {
		const path = join(base, 'a.ctl');
		writeFileSync(path, '');
		return path;
	}

	/**
	 * A wedged master used to be waited out and then abandoned, leaving one
	 * hung ssh behind per connect attempt.
	 */
	it('kills an ssh that never answers, and still lets the connect go on', async () => {
		vi.useFakeTimers();
		const { cancelForward } = await import('./connections');
		let settled = false;
		const pending = cancelForward(
			controlFile(),
			'/run/a.sock',
			'/home/u/herdr.sock',
			'tm-dev'
		).then(() => (settled = true));
		const { args, child } = ssh.spawned[0];
		expect(args.slice(-2)).toEqual(['--', 'tm-dev']);

		await vi.advanceTimersByTimeAsync(3_999);
		expect(child.kill).not.toHaveBeenCalled();
		expect(settled).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		await pending;
		expect(child.kill).toHaveBeenCalledTimes(1);
		expect(settled).toBe(true);
	});

	it('clears its timer when ssh answers in time', async () => {
		vi.useFakeTimers();
		const { cancelForward } = await import('./connections');
		const pending = cancelForward(controlFile(), '/run/a.sock', '/home/u/herdr.sock', 'tm-dev');
		const { child } = ssh.spawned[0];
		child.emit('exit', 0);
		await pending;
		expect(vi.getTimerCount()).toBe(0);
		expect(child.kill).not.toHaveBeenCalled();
	});

	it('clears its timer when ssh cannot be started', async () => {
		vi.useFakeTimers();
		const { cancelForward } = await import('./connections');
		const pending = cancelForward(controlFile(), '/run/a.sock', '/home/u/herdr.sock', 'tm-dev');
		ssh.spawned[0].child.emit('error', new Error('ENOENT'));
		await pending;
		expect(vi.getTimerCount()).toBe(0);
	});

	it('spawns nothing when there is no control master to ask', async () => {
		const { cancelForward } = await import('./connections');
		await cancelForward(join(base, 'missing.ctl'), '/run/a.sock', '/r.sock', 'tm-dev');
		expect(ssh.spawned).toHaveLength(0);
	});
});

describe('cached permission identity (pre-existing defect)', () => {
	it('separates target and session and rejects removed machines without SSH', async () => {
		const { connectionKey, ensureConnection, runOn } = await import('./connections');
		expect(connectionKey(MACHINE)).not.toBe(connectionKey({ ...MACHINE, target: 'other' }));
		expect(connectionKey(MACHINE)).not.toBe(connectionKey({ ...MACHINE, session: 'other' }));
		const saved = policy.machines;
		try {
			policy.machines = [];
			expect(await ensureConnection('a')).toBeNull();
			expect(await runOn(MACHINE, 'true')).toBeNull();
			expect(ssh.spawned).toHaveLength(0);
		} finally {
			policy.machines = saved;
		}
	});
});

it('revokes an already-live cached connection before reuse or command dispatch', async () => {
	const { ensureConnection, connectionFor, runOn } = await import('./connections');
	const pending = ensureConnection('a');
	await vi.waitFor(() => expect(ssh.spawned).toHaveLength(1));
	ssh.spawned[0].child.stdout.emit('data', '/fixture/home');
	ssh.spawned[0].child.emit('exit', 0);
	await vi.waitFor(() => expect(ssh.spawned).toHaveLength(2));
	const forward = ssh.spawned[1];
	const socket = forward.args[forward.args.indexOf('-L') + 1].split(':')[0];
	writeFileSync(socket, 'fixture socket');
	forward.child.emit('exit', 0);
	expect(await pending).not.toBeNull();
	expect(connectionFor('a')).toBeDefined();
	const previous = policy.machines;
	try {
		policy.machines = [{ ...MACHINE, enabled: false }];
		expect(await ensureConnection('a')).toBeNull();
		expect(await runOn(MACHINE, 'true')).toBeNull();
		policy.machines = [{ ...MACHINE, target: 'replacement' }];
		expect(connectionFor('a')).toBeUndefined();
		policy.machines = [{ ...MACHINE, session: 'replacement' }];
		expect(connectionFor('a')).toBeUndefined();
		expect(ssh.spawned).toHaveLength(2);
	} finally {
		policy.machines = previous;
	}
});
