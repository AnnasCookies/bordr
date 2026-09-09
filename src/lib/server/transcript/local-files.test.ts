import { describe, expect, it, vi } from 'vitest';

vi.mock('../files', () => ({
	servableUrl: (path: string) =>
		path.startsWith('/home/tony/repos/')
			? `/raw/repos/${path.slice('/home/tony/repos/'.length)}`
			: null
}));

const { rewriteLocalPaths } = await import('./local-files');

describe('rewriteLocalPaths', () => {
	it('points an image at a URL the phone can fetch', () => {
		expect(rewriteLocalPaths('![chart](/home/tony/repos/out.png)')).toBe(
			'![chart](/raw/repos/out.png)'
		);
	});

	it('sends a plain link to the file viewer rather than the raw bytes', () => {
		// The viewer pages images, renders markdown and offers a download; raw
		// bytes just dump in the browser.
		expect(rewriteLocalPaths('[the log](/home/tony/repos/run.log)')).toBe(
			'[the log](/f/repos/run.log)'
		);
	});

	it('leaves a path outside every root exactly as written', () => {
		// Better to read as the path it is than to pretend it is a link.
		const outside = '![x](/etc/shadow)';
		expect(rewriteLocalPaths(outside)).toBe(outside);
	});

	it('leaves remote and relative targets alone', () => {
		expect(rewriteLocalPaths('![x](https://example.com/a.png)')).toBe(
			'![x](https://example.com/a.png)'
		);
		expect(rewriteLocalPaths('[x](./notes.md)')).toBe('[x](./notes.md)');
	});
});
