import { describe, expect, it } from 'vitest';
import { ansiToHtml, stripAnsi } from './ansi';

const ESC = String.fromCharCode(27);
const sgr = (codes: string) => `${ESC}[${codes}m`;

describe('ansiToHtml', () => {
	it('renders plain text untouched', () => {
		expect(ansiToHtml('hello world')).toBe('hello world');
	});

	it('escapes HTML in the payload', () => {
		expect(ansiToHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
	});

	it('escapes HTML inside a styled run too', () => {
		const html = ansiToHtml(`${sgr('31')}<b>${sgr('0')}`);
		expect(html).toContain('&lt;b&gt;');
		expect(html).not.toContain('<b>');
	});

	it('colours a red run and resets', () => {
		const html = ansiToHtml(`${sgr('31')}bad${sgr('0')} fine`);
		expect(html).toContain('color:#f87171');
		expect(html).toContain('bad');
		expect(html).toContain(' fine');
	});

	it('supports bold and 256-colour', () => {
		const html = ansiToHtml(`${sgr('1')}${sgr('38;5;46')}ok`);
		expect(html).toContain('font-weight:600');
		expect(html).toMatch(/color:rgb\(\d+,\d+,\d+\)/);
	});

	it('drops non-SGR control sequences rather than printing them', () => {
		const html = ansiToHtml(`${ESC}[2J${ESC}[H${ESC}[1;5Hplain`);
		expect(html).toBe('plain');
	});

	it('drops OSC sequences (window titles)', () => {
		const html = ansiToHtml(`${ESC}]0;my titlevisible`);
		expect(html).toBe('visible');
	});

	it('carries style across lines until reset', () => {
		const html = ansiToHtml(`${sgr('32')}one\ntwo${sgr('0')}`);
		expect(html).toContain('one\ntwo');
		expect(html).toContain('color:#4ade80');
	});
});

describe('ansiToHtml: terminal cell grid', () => {
	/**
	 * The /effort slider drew its ruler in box-drawing characters and its marker
	 * in a geometric one. No font in the stack covers them, so each fell back
	 * separately at a different advance and the marker drifted about seven cells
	 * from the labels below it.
	 */
	it('pins every non-ASCII glyph to one cell', () => {
		const html = ansiToHtml('──▲──', true);
		expect(html.match(/class="tc"/g)).toHaveLength(5);
	});

	it('gives a two-column character two cells', () => {
		expect(ansiToHtml('📁', true)).toContain('class="tc tc-w"');
		expect(ansiToHtml('─', true)).not.toContain('tc-w');
	});

	it('leaves ASCII alone, so ordinary output costs nothing', () => {
		expect(ansiToHtml('plain text', true)).toBe('plain text');
		expect(ansiToHtml('low medium high', true)).not.toContain('<span');
	});

	it('is off by default, for prose', () => {
		expect(ansiToHtml('──')).toBe('──');
	});

	/** Escaping must survive the extra wrapping. */
	it('still escapes markup, gridded or not', () => {
		for (const gridded of [true, false]) {
			const html = ansiToHtml('<script>alert(1)</script> ─', gridded);
			expect(html).not.toContain('<script');
			expect(html).toContain('&lt;script&gt;');
		}
	});

	it('keeps colour and the grid together', () => {
		const html = ansiToHtml('\u001b[31m─\u001b[0m', true);
		expect(html).toContain('color:#f87171');
		expect(html).toContain('class="tc"');
	});
});

describe('stripAnsi', () => {
	const E = String.fromCharCode(27);

	it('leaves what a terminal would actually show', () => {
		expect(stripAnsi(`${E}[0m${E}[38;2;136;136;136mCTX 48%${E}[0m`)).toBe('CTX 48%');
	});

	it('is a no-op on text that carries no escapes', () => {
		expect(stripAnsi('plain 100%')).toBe('plain 100%');
	});

	it('drops OSC sequences too, not just SGR', () => {
		// BEL-terminated, which is the form a shell actually writes a title in.
		expect(stripAnsi(`${E}]0;a title\u0007done`)).toBe('done');
	});
});
