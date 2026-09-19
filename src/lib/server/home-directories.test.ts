import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHomeDirectory, DirectoryError, homeDisplay } from './home-directories';

/** The errno the next mkdir should fail with; empty means the real mkdir runs. */
const mkdirFails = vi.hoisted(() => ({ code: '' }));

// Some errno codes cannot be produced on demand, so a test can arm one. The
// fake message names the path, as the real one does, to prove it never leaks.
vi.mock('node:fs', async (importOriginal) => {
	const fs = await importOriginal<typeof import('node:fs')>();
	const mkdir = (...args: Parameters<typeof fs.mkdirSync>) => {
		if (!mkdirFails.code) return fs.mkdirSync(...args);
		throw Object.assign(new Error(`${mkdirFails.code}: mkdir '${String(args[0])}'`), {
			code: mkdirFails.code
		});
	};
	return { ...fs, mkdirSync: mkdir };
});

const made: string[] = [];

/**
 * A throwaway home one level inside its own temporary folder, so a name that
 * escaped home lands in the sandbox, where a test can see it, rather than in
 * the shared temp directory.
 */
function home(): string {
	const sandbox = mkdtempSync(join(tmpdir(), 'bordr-dirs-'));
	made.push(sandbox);
	const path = join(sandbox, 'home');
	mkdirSync(path);
	return path;
}

/**
 * The refusal an action throws, as the message and status the route sends,
 * or null when it went through. Null rather than a throw keeps a soft
 * assertion soft, so the checks on the disk still run.
 */
function refusal(action: () => unknown): { message: string; status: number } | null {
	try {
		action();
	} catch (cause) {
		if (cause instanceof DirectoryError) return { message: cause.message, status: cause.status };
		throw cause;
	}
	return null;
}

afterEach(() => {
	mkdirFails.code = '';
	for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('createHomeDirectory', () => {
	it('creates a direct child and makes a retry idempotent', () => {
		const root = home();
		const parent = join(root, 'projects');
		mkdirSync(parent);

		expect(createHomeDirectory(root, parent, 'new app')).toEqual({
			path: join(parent, 'new app'),
			created: true
		});
		expect(createHomeDirectory(root, parent, 'new app')).toEqual({
			path: join(parent, 'new app'),
			created: false
		});
	});

	it('refuses dot names, hidden names and parents outside home', () => {
		const root = home();
		const outside = home();
		for (const name of ['.', '..', '../escape']) {
			expect(() => createHomeDirectory(root, root, name)).toThrow(
				'folder name must not contain a path'
			);
		}
		expect(() => createHomeDirectory(root, root, '.hidden')).toThrow('hidden folder names');
		expect(() => createHomeDirectory(root, outside, 'escape')).toThrow('outside home');
	});

	it('refuses a name that carries a path before anything is created', () => {
		const root = home();
		// Without the separator check, the first name creates `escaped` BESIDE
		// home and only then trips the containment check; the second fails with
		// ENOENT and the third makes one oddly named folder inside home.
		for (const name of ['x/../../escaped', 'a/b', 'x\\..\\..\\escaped']) {
			expect.soft(refusal(() => createHomeDirectory(root, root, name))).toEqual({
				message: 'folder name must not contain a path',
				status: 400
			});
		}
		expect(readdirSync(dirname(root))).toEqual(['home']);
		expect(readdirSync(root)).toEqual([]);
	});

	it('refuses a parent in a hidden folder, including through a symlink', () => {
		const root = home();
		mkdirSync(join(root, '.config', 'x'), { recursive: true });
		mkdirSync(join(root, '.ssh'));
		symlinkSync(join(root, '.config'), join(root, 'settings'));

		for (const parent of [join(root, '.ssh'), join(root, '.config', 'x'), join(root, 'settings')]) {
			expect.soft(refusal(() => createHomeDirectory(root, parent, 'new'))).toEqual({
				message: 'parent folder is hidden',
				status: 400
			});
		}
		expect(readdirSync(join(root, '.ssh'))).toEqual([]);
		expect(readdirSync(join(root, '.config', 'x'))).toEqual([]);
	});

	it('refuses an existing plain-named symlink that leads into a hidden folder', () => {
		const root = home();
		mkdirSync(join(root, '.config'));
		symlinkSync(join(root, '.config'), join(root, 'dots'));
		expect(() => createHomeDirectory(root, root, 'dots')).toThrow('resolves to a hidden folder');
	});

	it('counts only hidden folders below home, not the ones home sits in', () => {
		const root = join(home(), '.dotted-home');
		mkdirSync(root);
		expect(createHomeDirectory(root, root, 'project')).toEqual({
			path: join(root, 'project'),
			created: true
		});
	});

	it('refuses control characters and names over 255 bytes', () => {
		const root = home();
		for (const name of ['a\x00b', 'a\x07b', 'a\nb', 'a\x1bb', 'a\x7fb']) {
			expect.soft(refusal(() => createHomeDirectory(root, root, name))).toEqual({
				message: 'folder name is not valid',
				status: 400
			});
		}
		// 128 two-byte characters: under 255 characters, over 255 bytes.
		for (const name of ['\xe9'.repeat(128), 'a'.repeat(256)]) {
			expect.soft(refusal(() => createHomeDirectory(root, root, name))).toEqual({
				message: 'folder name is too long',
				status: 400
			});
		}
		expect(readdirSync(root)).toEqual([]);
		expect(createHomeDirectory(root, root, 'a'.repeat(255)).created).toBe(true);
	});

	it('maps mkdir failures to a status and never echoes the path', () => {
		const root = home();
		const cases = [
			['EACCES', 'permission denied', 403],
			['EPERM', 'permission denied', 403],
			['ENAMETOOLONG', 'folder name is too long', 400],
			['EIO', 'could not create folder', 500]
		] as const;
		for (const [code, message, status] of cases) {
			mkdirFails.code = code;
			const refused = refusal(() => createHomeDirectory(root, root, 'project'));
			expect.soft(refused).toEqual({ message, status });
			expect.soft(refused?.message ?? '').not.toContain(root);
		}
	});

	it('refuses an existing file and a symlink that leaves home', () => {
		const root = home();
		writeFileSync(join(root, 'taken'), 'x');
		expect(() => createHomeDirectory(root, root, 'taken')).toThrow('file already has that name');

		const outside = home();
		symlinkSync(outside, join(root, 'linked'));
		expect(() => createHomeDirectory(root, root, 'linked')).toThrow('resolves outside home');
	});
});

describe('homeDisplay', () => {
	it('abbreviates only a leading real home', () => {
		expect(homeDisplay('/srv/me', '/srv/me')).toBe('~');
		expect(homeDisplay('/srv/me', '/srv/me/code')).toBe('~/code');
		expect(homeDisplay('/srv/me', '/srv/meadow')).toBe('/srv/meadow');
		expect(homeDisplay('/srv/me', '/data/srv/me/code')).toBe('/data/srv/me/code');
	});
});
