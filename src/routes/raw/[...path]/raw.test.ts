import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artefactToken } from '$lib/server/artefact-token';
import { GET } from './+server';

const root = mkdtempSync(join(tmpdir(), 'bordr-raw-capability-'));
mkdirSync(join(root, 'report', 'assets'), { recursive: true });
for (const file of ['report/app.js', 'report/style.css', 'report/assets/app.js', 'secret.js']) {
	writeFileSync(join(root, file), '/* synthetic fixture */');
}
writeFileSync(join(root, 'report/index.html'), '<script src="app.js"></script>');
symlinkSync(join(root, 'secret.js'), join(root, 'report', 'alias.js'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

vi.mock('$lib/server/files', async (importOriginal) => {
	const files = await importOriginal<typeof import('$lib/server/files')>();
	return { ...files, resolveSafe: (path: string) => files.resolveSafe(path, { fixture: root }) };
});

function get(path: string, site: string) {
	const url = new URL(`http://bordr.test/raw/${path}`);
	return GET({
		params: { path },
		url,
		request: new Request(url, { headers: { 'sec-fetch-site': site } })
	} as Parameters<typeof GET>[0]);
}

describe('raw executable assets', () => {
	it('keeps an unrelated website from executing any untokenised script or stylesheet', async () => {
		for (const file of ['app.js', 'style.css']) {
			const response = await get(`fixture/report/${file}`, 'cross-site');
			expect(response.headers.get('content-type')).toContain('text/plain');
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		}
	});

	it('allows sibling and nested assets only in a sandbox with a valid directory grant', async () => {
		const prefix = `~${artefactToken(join(root, 'report'))}/fixture/`;
		expect(
			(await get(`${prefix}report/app.js`, 'cross-site')).headers.get('content-type')
		).toContain('text/javascript');
		expect(
			(await get(`${prefix}report/assets/app.js`, 'cross-site')).headers.get('content-type')
		).toContain('text/javascript');
		expect(
			(await get(`${prefix}report/style.css`, 'cross-site')).headers.get('content-type')
		).toContain('text/css');
		expect((await get(`${prefix}secret.js`, 'cross-site')).headers.get('content-type')).toContain(
			'text/plain'
		);
		expect(
			(await get(`${prefix}report/alias.js`, 'cross-site')).headers.get('content-type')
		).toContain('text/plain');
		expect(
			(await get(`${prefix}report/app.js`, 'same-origin')).headers.get('content-type')
		).toContain('text/plain');
	});

	it('keeps HTML sandboxed and prevents capability-bearing URLs leaking in Referer', async () => {
		const response = await get('fixture/report/index.html', 'same-origin');
		expect(response.headers.get('content-security-policy')).toBe('sandbox allow-scripts');
		expect(response.headers.get('referrer-policy')).toBe('no-referrer');
	});
});
