import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listDirectory, resolveSafe, viewerKind } from './files';

// A throwaway root with a real file, plus a symlink escaping it.
const OUTSIDE = mkdtempSync(join(tmpdir(), 'bordr-outside-'));
const ROOT = mkdtempSync(join(tmpdir(), 'bordr-root-'));
writeFileSync(join(OUTSIDE, 'secret.txt'), 'nope');
mkdirSync(join(ROOT, 'sub'));
mkdirSync(join(ROOT, 'node_modules'));
writeFileSync(join(ROOT, '.env'), 'VAPID_PRIVATE_KEY=secret');
writeFileSync(join(ROOT, 'report.html'), '<p>hi</p>');
writeFileSync(join(ROOT, 'notes.md'), '# hi');
writeFileSync(join(ROOT, 'sub', 'real.txt'), 'yes');
symlinkSync(join(OUTSIDE, 'secret.txt'), join(ROOT, 'sub', 'sneaky.txt'));
symlinkSync(OUTSIDE, join(ROOT, 'sub', 'sneakydir'));
// A symlink INSIDE the root whose target is a dotfile in the same root.
symlinkSync(join(ROOT, '.env'), join(ROOT, 'sub', 'notes.txt'));
const ROOTS = { t: ROOT };

afterAll(() => {
	rmSync(ROOT, { recursive: true, force: true });
	rmSync(OUTSIDE, { recursive: true, force: true });
});

describe('resolveSafe', () => {
	it('maps a rooted path onto a real file', () => {
		expect(resolveSafe('t/sub/real.txt', ROOTS)).toContain(join('sub', 'real.txt'));
	});

	it('maps the bare root', () => {
		expect(resolveSafe('t', ROOTS)).toBeTruthy();
	});

	it('refuses a symlink whose target lives outside the root', () => {
		expect(resolveSafe('t/sub/sneaky.txt', ROOTS)).toBeNull();
		expect(resolveSafe('t/sub/sneakydir/secret.txt', ROOTS)).toBeNull();
	});

	it('returns null for files that do not exist', () => {
		expect(resolveSafe('t/no-such-file', ROOTS)).toBeNull();
	});

	it('refuses traversal', () => {
		expect(resolveSafe('t/../../.ssh/id_ed25519', ROOTS)).toBeNull();
		expect(resolveSafe('t/..', ROOTS)).toBeNull();
		expect(resolveSafe('../etc/passwd', ROOTS)).toBeNull();
	});

	it('refuses unknown roots and empty paths', () => {
		expect(resolveSafe('etc/passwd', ROOTS)).toBeNull();
		expect(resolveSafe('', ROOTS)).toBeNull();
		expect(resolveSafe('/', ROOTS)).toBeNull();
	});
});

describe('resolveSafe: dotfiles', () => {
	/**
	 * `.env` holds the VAPID private key. Refusing it at the RESOLVER rather
	 * than hiding it from the listing is the point: an unlisted file that a
	 * direct URL still serves is theatre, and the browser is reachable by
	 * anything on the tailnet.
	 */
	it('refuses any dotfile, however it is reached', () => {
		expect(resolveSafe('t/.env', ROOTS)).toBeNull();
		expect(resolveSafe('t/sub/../.env', ROOTS)).toBeNull();
		expect(resolveSafe('t/.ssh/id_ed25519', ROOTS)).toBeNull();
	});

	it('refuses a symlink whose resolved target is a dotfile, even inside the root', () => {
		expect(resolveSafe('t/sub/notes.txt', ROOTS)).toBeNull();
	});

	it('still serves ordinary files beside them', () => {
		expect(resolveSafe('t/sub/real.txt', ROOTS)).toBeTruthy();
	});
});

describe('listDirectory', () => {
	const names = listDirectory(ROOT).map((e) => e.name);

	it('never lists a dotfile', () => {
		expect(names.some((n) => n.startsWith('.'))).toBe(false);
	});

	it('omits node_modules noise but keeps real content', () => {
		expect(names).not.toContain('node_modules');
		expect(names).toEqual(expect.arrayContaining(['sub', 'report.html', 'notes.md']));
	});

	it('puts directories first', () => {
		expect(names[0]).toBe('sub');
	});
});

describe('viewerKind', () => {
	it('routes each extension to the body that can render it', () => {
		expect(viewerKind('notes.md')).toBe('markdown');
		expect(viewerKind('shot.PNG')).toBe('image');
		expect(viewerKind('paper.pdf')).toBe('pdf');
		expect(viewerKind('report.html')).toBe('sandboxed');
		expect(viewerKind('logo.svg')).toBe('sandboxed');
		expect(viewerKind('data.csv')).toBe('text');
		expect(viewerKind('run.log')).toBe('text');
		expect(viewerKind('archive.zip')).toBe('binary');
		expect(viewerKind('LICENSE')).toBe('binary');
	});
});
