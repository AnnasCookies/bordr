import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHomeDirectory } from './home-directories';

const made: string[] = [];

function home(): string {
	const path = mkdtempSync(join(tmpdir(), 'bordr-dirs-'));
	made.push(path);
	return path;
}

afterEach(() => {
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

	it('refuses traversal, hidden names and parents outside home', () => {
		const root = home();
		const outside = home();
		for (const name of ['../escape', 'a/b', '.hidden', '..']) {
			expect(() => createHomeDirectory(root, root, name)).toThrow();
		}
		expect(() => createHomeDirectory(root, outside, 'escape')).toThrow('outside home');
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
