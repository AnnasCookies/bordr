import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const made: string[] = [];

/**
 * A throwaway home reached through a symlink, the shape that broke the
 * display path. `real` is where the folders land; `link` is what HOME says.
 */
function sandbox(): { real: string; link: string } {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'bordr-dirs-')));
	made.push(root);
	const real = join(root, 'real-home');
	mkdirSync(real);
	const link = join(root, 'home');
	symlinkSync(real, link);
	return { real, link };
}

/**
 * The route, loaded against a throwaway HOME. It reads homedir() once at
 * import, so every test re-imports it after stubbing the variable; no test
 * can reach the real home.
 */
async function route(home: string) {
	vi.stubEnv('HOME', home);
	vi.resetModules();
	return import('./+server');
}

async function post(home: string, body: string) {
	const { POST } = await route(home);
	const request = new Request('http://bordr.test/api/dirs', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body
	});
	const response = await POST({ request } as never);
	return { status: response.status, body: await response.json() };
}

afterEach(() => {
	vi.unstubAllEnvs();
	for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('POST /api/dirs', () => {
	it('rejects malformed JSON', async () => {
		expect(await post(sandbox().link, '{')).toEqual({
			status: 400,
			body: { message: 'request must be JSON' }
		});
	});

	it('rejects a non-string parent path', async () => {
		expect(await post(sandbox().link, '{"parent":42,"name":"project"}')).toEqual({
			status: 400,
			body: { message: 'parent folder must be a path' }
		});
	});

	it('shows the new folder under ~ when home is a symlink', async () => {
		const { real, link } = sandbox();
		expect(await post(link, '{"parent":"~","name":"project"}')).toEqual({
			status: 200,
			body: { path: join(real, 'project'), created: true, display: '~/project' }
		});
	});

	it('refuses a parent inside a hidden folder', async () => {
		const { real, link } = sandbox();
		mkdirSync(join(real, '.config', 'x'), { recursive: true });
		for (const parent of ['~/.config', '~/.config/x']) {
			const body = JSON.stringify({ parent, name: 'project' });
			expect.soft(await post(link, body)).toEqual({
				status: 400,
				body: { message: 'parent folder is hidden' }
			});
		}
		expect(readdirSync(join(real, '.config'))).toEqual(['x']);
		expect(readdirSync(join(real, '.config', 'x'))).toEqual([]);
	});

	it('refuses control characters and over-long names with 400', async () => {
		const { real, link } = sandbox();
		expect(await post(link, JSON.stringify({ name: 'a\x07b' }))).toEqual({
			status: 400,
			body: { message: 'folder name is not valid' }
		});
		expect(await post(link, JSON.stringify({ name: 'a'.repeat(256) }))).toEqual({
			status: 400,
			body: { message: 'folder name is too long' }
		});
		expect(readdirSync(real)).toEqual([]);
	});

	// Root ignores directory permissions, so the refusal cannot happen there.
	it.skipIf(process.getuid?.() === 0)(
		'answers 403 without the path when home is not writable',
		async () => {
			const { real, link } = sandbox();
			chmodSync(real, 0o500);
			try {
				expect(await post(link, '{"name":"project"}')).toEqual({
					status: 403,
					body: { message: 'permission denied' }
				});
			} finally {
				chmodSync(real, 0o700);
			}
			expect(existsSync(join(real, 'project'))).toBe(false);
		}
	);
});

describe('GET /api/dirs', () => {
	it('shows a symlinked home as ~', async () => {
		const { real, link } = sandbox();
		const { GET } = await route(link);
		const response = await GET({ url: new URL('http://bordr.test/api/dirs') } as never);
		expect(await response.json()).toMatchObject({ path: real, display: '~', parent: null });
	});
});
