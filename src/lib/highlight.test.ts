import { describe, expect, it } from 'vitest';
import { canonicalLang, highlight, langForPath } from './highlight';

describe('canonicalLang', () => {
	it('resolves the aliases people actually type', () => {
		expect(canonicalLang('ts')).toBe('typescript');
		expect(canonicalLang('sh')).toBe('bash');
		expect(canonicalLang('YML')).toBe('yaml');
	});

	it('returns null for a language with no grammar, so the caller falls back', () => {
		expect(canonicalLang('brainfuck')).toBeNull();
		expect(canonicalLang('')).toBeNull();
		expect(canonicalLang(null)).toBeNull();
	});
});

describe('langForPath', () => {
	it('reads the language off an extension, for a diff', () => {
		expect(langForPath('/a/b/projector.ts')).toBe('typescript');
		expect(langForPath('build-nerd-subset.sh')).toBe('bash');
	});

	it('is null for a path with no usable extension', () => {
		expect(langForPath('Makefile')).toBeNull();
		expect(langForPath('/etc/hosts')).toBeNull();
	});
});

describe('highlight', () => {
	it('emits coloured spans for a known language', async () => {
		const html = await highlight('const a = 1;', 'ts', true);
		expect(html).toContain('<span');
		expect(html).toMatch(/color:#/i);
	});

	it('escapes the source rather than passing markup through', async () => {
		// The input is agent-authored text; nothing in it may survive as HTML.
		const html = await highlight('const x = "<img src=x onerror=alert(1)>";', 'ts', true);
		expect(html).not.toContain('<img');
		// shiki escapes with a hex reference (&#x3C;) rather than &lt;. Either
		// is fine; what matters is that no `<` survives to open a tag.
		expect(html).toMatch(/(&lt;|&#x3C;)img/i);
	});

	it('returns null for an unknown language instead of throwing', async () => {
		expect(await highlight('whatever', 'not-a-language', false)).toBeNull();
	});
});
