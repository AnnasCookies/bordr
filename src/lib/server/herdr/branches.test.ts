import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { branchUrl, branchesFor, localBranch, parseCounts, parseRemoteRow } from './branches';

function repo(head: string, nested = ''): string {
	const dir = mkdtempSync(join(tmpdir(), 'bordr-branch-'));
	execFileSync('git', ['init', dir], { stdio: 'pipe' });
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

describe('parseCounts', () => {
	it('reads left as behind and right as ahead', () => {
		// `git rev-list --count --left-right @{u}...HEAD` prints upstream-only
		// first. Reversing these is the bug this test exists to catch.
		expect(parseCounts('2\t3')).toEqual({ behind: 2, ahead: 3 });
	});

	it('is zero when the branch has no upstream', () => {
		expect(parseCounts('')).toEqual({ behind: 0, ahead: 0 });
	});
});

describe('branchesFor', () => {
	it('reports real ahead/behind against a real upstream', async () => {
		const git = (cwd: string, args: string[]) =>
			execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });

		const root = mkdtempSync(join(tmpdir(), 'bordr-ab-'));
		const origin = join(root, 'origin');
		const clone = join(root, 'clone');
		mkdirSync(origin, { recursive: true });

		git(origin, ['init', '--quiet', '--initial-branch=main']);
		git(origin, ['config', 'user.email', 't@example.com']);
		git(origin, ['config', 'user.name', 'Test']);
		writeFileSync(join(origin, 'a'), '1');
		git(origin, ['add', '-A']);
		git(origin, ['commit', '--quiet', '-m', 'one']);

		git(root, ['clone', '--quiet', origin, clone]);
		git(clone, ['config', 'user.email', 't@example.com']);
		git(clone, ['config', 'user.name', 'Test']);

		// Two commits only the clone has, one only the origin has.
		for (const n of ['b', 'c']) {
			writeFileSync(join(clone, n), '1');
			git(clone, ['add', '-A']);
			git(clone, ['commit', '--quiet', '-m', n]);
		}
		writeFileSync(join(origin, 'd'), '1');
		git(origin, ['add', '-A']);
		git(origin, ['commit', '--quiet', '-m', 'd']);
		git(clone, ['fetch', '--quiet']);
		// The clone was made from a path on disk, which has no web page. Point
		// it at the spelling a real checkout has, so this also proves the URL
		// is read from the UPSTREAM's remote and reaches the caller.
		git(clone, ['config', 'remote.origin.url', 'git@github.com:sling86/bordr.git']);

		const found = await branchesFor(null, [clone]);
		expect(found.get(clone)).toEqual({
			branch: 'main',
			ahead: 2,
			behind: 1,
			url: 'https://github.com/sling86/bordr/tree/main'
		});

		rmSync(root, { recursive: true, force: true });
	});

	it('gives nothing for a directory that is not a repository', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'bordr-norepo-'));
		expect((await branchesFor(null, [dir])).get(dir)).toBeUndefined();
	});
});

describe('branchUrl', () => {
	const WEB = 'https://github.com/sling86/bordr/tree/feat/rich-transcript';

	it('reads the scp-like form git uses for ssh remotes', () => {
		expect(branchUrl('git@github.com:sling86/bordr.git', 'feat/rich-transcript')).toBe(WEB);
	});

	it('reads an https remote, with or without the .git suffix', () => {
		expect(branchUrl('https://github.com/sling86/bordr.git', 'feat/rich-transcript')).toBe(WEB);
		expect(branchUrl('https://github.com/sling86/bordr', 'feat/rich-transcript')).toBe(WEB);
	});

	it('reads the ssh:// URL form', () => {
		expect(branchUrl('ssh://git@github.com/sling86/bordr.git', 'feat/rich-transcript')).toBe(WEB);
	});

	it('keeps the slashes in a branch name but escapes what would break the URL', () => {
		expect(branchUrl('git@github.com:sling86/bordr.git', 'fix/a#b')).toBe(
			'https://github.com/sling86/bordr/tree/fix/a%23b'
		);
	});

	// Every forge spells a branch page differently, so a guess would 404. No
	// link is the honest answer, and the branch then renders as plain text.
	it('links nothing for a forge whose URL shape it does not know', () => {
		expect(branchUrl('git@gitlab.com:team/thing.git', 'main')).toBe('');
		expect(branchUrl('https://git.example.com/team/thing.git', 'main')).toBe('');
	});

	it('links nothing without a remote or a branch', () => {
		expect(branchUrl('', 'main')).toBe('');
		expect(branchUrl('git@github.com:sling86/bordr.git', '')).toBe('');
		expect(branchUrl('not a remote at all', 'main')).toBe('');
	});
});

describe('parseRemoteRow', () => {
	it('reads a full row from a machine over ssh', () => {
		const row = parseRemoteRow(
			'/home/tony/bordr\tfeat/rich-transcript\tgit@github.com:sling86/bordr.git\tfeat/rich-transcript\t1\t2'
		);
		expect(row).toEqual({
			cwd: '/home/tony/bordr',
			info: {
				branch: 'feat/rich-transcript',
				behind: 1,
				ahead: 2,
				url: 'https://github.com/sling86/bordr/tree/feat/rich-transcript'
			}
		});
	});

	// Why rev-list has to be the LAST field. It prints nothing when there is no
	// upstream, so a field after it would land in the column meant for `ahead`.
	// This row puts a URL where that field would be to prove it does not.
	it('reads zero counts from an empty trailing field without shifting the columns', () => {
		const row = parseRemoteRow('/srv/app\tmain\tgit@github.com:sling86/app.git\tmain\t');
		expect(row?.info).toEqual({
			branch: 'main',
			ahead: 0,
			behind: 0,
			url: 'https://github.com/sling86/app/tree/main'
		});
	});

	it('links nothing when the remote field is empty', () => {
		const row = parseRemoteRow('/srv/app\tmain\t\t\t0\t0');
		expect(row?.info.branch).toBe('main');
		expect(row?.info.url).toBe('');
	});

	it('skips a directory that is not a repository, and a detached HEAD', () => {
		expect(parseRemoteRow('/tmp/plain\t\t\t')).toBeNull();
		expect(parseRemoteRow('/tmp/detached\tHEAD\t\t')).toBeNull();
		expect(parseRemoteRow('no tabs at all')).toBeNull();
	});
});

it('resolves linked worktree metadata rather than an enclosing repository (older defect)', () => {
	const dir = mkdtempSync(join(tmpdir(), 'bordr-worktree-'));
	const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
	try {
		git('init');
		git(
			'-c',
			'user.name=Fixture',
			'-c',
			'user.email=fixture@example.invalid',
			'commit',
			'--allow-empty',
			'-m',
			'fixture'
		);
		git('worktree', 'add', '-b', 'linked', join(dir, 'child'));
		expect(localBranch(join(dir, 'child'))).toBe('linked');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

it('uses the upstream branch name when it differs from the local one', () => {
	expect(
		parseRemoteRow('/repo\tlocal\tgit@github.com:o/r.git\tupstream-name\t0\t0')?.info.url
	).toBe('https://github.com/o/r/tree/upstream-name');
});
