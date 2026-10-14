import { afterEach, expect, it } from 'vitest';
import {
	chmodSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
	existsSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const temporary: string[] = [];
afterEach(() => {
	for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function generate(args: string[]) {
	const root = mkdtempSync(join(tmpdir(), 'bordr-units-'));
	temporary.push(root);
	const bin = join(root, 'bin');
	const units = join(root, 'units');
	const polkit = join(root, 'polkit');
	for (const dir of [bin, units, polkit]) mkdirSync(dir);
	for (const [name, script] of Object.entries({
		getent: "printf 'fixture:x:1000:1000:Fixture:/fixture:/bin/sh\\n'",
		id: 'if [ "$1" = -u ]; then printf "0\\n"; else printf "fixture\\n"; fi',
		systemctl: 'printf "%s\\n" "$*" >> "$CALLS"',
		herdr: 'exit 0'
	})) {
		const path = join(bin, name);
		writeFileSync(path, `#!/usr/bin/env bash\n${script}\n`);
		chmodSync(path, 0o755);
	}
	const calls = join(root, 'calls');
	const result = spawnSync(
		'bash',
		[resolve('deploy/install-system-units.sh'), '--user', 'fixture', ...args],
		{
			encoding: 'utf8',
			env: {
				...process.env,
				PATH: bin + delimiter + process.env.PATH,
				SYSTEMD_SYSTEM_DIR: units,
				POLKIT_RULES_DIR: polkit,
				BUN_BIN: process.execPath,
				HERDR_BIN: join(bin, 'herdr'),
				CALLS: calls
			}
		}
	);
	return { result, units, polkit, calls };
}

// The installer is deliberately Linux/systemd-only; this is not a Windows runtime claim.
it.skipIf(process.platform === 'win32').each([
	{ args: [] as string[], name: 'bordr', env: '.env', session: 'main', herdr: true },
	{
		args: ['--bordr-only', '--session', 'default'],
		name: 'bordr',
		env: '.env',
		session: 'default',
		herdr: false
	},
	{
		args: ['--instance', 'dulce', '--session', 'dulce'],
		name: 'bordr-dulce',
		env: '.env.dulce',
		session: 'dulce',
		herdr: false
	}
])(
	'renders isolated $name units without restarting services',
	({ args, name, env, session, herdr }) => {
		const { result, units, polkit, calls } = generate(args);
		expect(result.status).toBe(0);
		const unit = readFileSync(join(units, `${name}.service`), 'utf8');
		expect(
			unit
				.split('\n')
				.filter((line) => !line.trimStart().startsWith('#'))
				.join('\n')
		).not.toMatch(/__[A-Z_]+__/);
		expect(unit).toContain(`RuntimeDirectory=${name}\nRuntimeDirectoryMode=0700`);
		expect(unit).toContain(`Environment=SOCKET_PATH=/run/${name}/bordr.sock`);
		expect(unit).toContain(`EnvironmentFile=${resolve(env)}`);
		expect(unit).toContain(`Environment=BORDR_DATA_DIR=/fixture/.local/state/${name}`);
		expect(unit).toContain(`/fixture/.local/lib/${name}/index.js`);
		const socket =
			session === 'default'
				? '/fixture/.config/herdr/herdr.sock'
				: `/fixture/.config/herdr/sessions/${session}/herdr.sock`;
		expect(unit).toContain(`Environment=HERDR_SOCKET=${socket}`);
		expect(existsSync(join(units, 'herdr-session.service'))).toBe(herdr);
		const rule = readFileSync(join(polkit, `50-${name}.rules`), 'utf8');
		expect(rule).toContain(`unit === '${name}.service'`);
		if (name === 'bordr') {
			expect(rule).toContain("unit === 'herdr-session.service'");
			expect(unit).not.toContain('--no-env-file');
		} else {
			expect(rule).not.toContain('herdr-session.service');
			expect(unit).toContain('--no-env-file');
		}
		expect(result.stdout).toContain(`systemctl --user disable --now ${name}`);
		if (!herdr) expect(result.stdout).not.toContain('disable --now herdr-session');
		expect(readFileSync(calls, 'utf8')).toBe('daemon-reload\n');
	}
);

it.skipIf(process.platform === 'win32')(
	'Bun named-service mode cannot inherit production dotenv values',
	() => {
		const root = mkdtempSync(join(tmpdir(), 'bordr-env-isolation-'));
		temporary.push(root);
		writeFileSync(join(root, '.env'), 'BORDR_UNIT_TEST_PROD_ONLY=fixture-production\n');
		const env = { ...process.env, BORDR_UNIT_TEST_INSTANCE: 'fixture-dev' };
		delete env.BORDR_UNIT_TEST_PROD_ONLY;
		const script =
			'console.log(JSON.stringify({prod:process.env.BORDR_UNIT_TEST_PROD_ONLY??null,instance:process.env.BORDR_UNIT_TEST_INSTANCE}))';
		const control = spawnSync('bun', ['-e', script], { cwd: root, env, encoding: 'utf8' });
		const isolated = spawnSync('bun', ['--no-env-file', '-e', script], {
			cwd: root,
			env,
			encoding: 'utf8'
		});
		expect(control.status).toBe(0);
		expect(JSON.parse(control.stdout)).toEqual({
			prod: 'fixture-production',
			instance: 'fixture-dev'
		});
		expect(isolated.status).toBe(0);
		expect(JSON.parse(isolated.stdout)).toEqual({ prod: null, instance: 'fixture-dev' });
	}
);

it.skipIf(process.platform === 'win32')(
	'rejects an unsafe instance before installing anything',
	() => {
		const { result, units, calls } = generate(['--instance', '../escape']);
		expect(result.status).toBe(2);
		expect(existsSync(join(units, 'bordr.service'))).toBe(false);
		expect(existsSync(calls)).toBe(false);
	}
);
