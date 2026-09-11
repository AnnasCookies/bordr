import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localBranch } from './branches';

function repo(head: string, nested = ''): string {
	const dir = mkdtempSync(join(tmpdir(), 'bordr-branch-'));
	mkdirSync(join(dir, '.git'), { recursive: true });
	writeFileSync(join(dir, '.git', 'HEAD'), head);
	if (nested) mkdirSync(join(dir, nested), { recursive: true });
	return nested ? join(dir, nested) : dir;
}

describe('localBranch', () => {
	it('reads the branch a checkout is on', () => {
		const dir = repo('ref: refs/heads/feat/rich-transcript\n');
		expect(localBranch(dir)).toBe('feat/rich-transcript');
		rmSync(dir, { recursive: true, force: true });
	});

	it('walks up from a subdirectory, as git does', () => {
		const nested = repo('ref: refs/heads/main\n', 'src/lib/server');
		expect(localBranch(nested)).toBe('main');
	});

	it('shows a short sha for a detached HEAD', () => {
		const dir = repo('3fb3daf1c0de5caf7729e0add49b7df628aa1234\n');
		expect(localBranch(dir)).toBe('3fb3daf');
	});

	it('is empty outside a repository, rather than guessing', () => {
		expect(localBranch(mkdtempSync(join(tmpdir(), 'bordr-nogit-')))).toBe('');
		expect(localBranch('')).toBe('');
	});
});
