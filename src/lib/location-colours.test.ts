import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastRatio } from './contrast';

/**
 * The location row's colours, read from the stylesheet rather than repeated
 * here — a copy would keep passing after someone edited the real palette.
 */
const CSS = readFileSync(join(import.meta.dirname, '../routes/layout.css'), 'utf8');

/** The value of `--name` inside the `:root` or `.dark` block. */
function token(name: string, theme: 'light' | 'dark'): string {
	const block =
		theme === 'light'
			? CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('.dark {'))
			: CSS.slice(CSS.indexOf('.dark {'));
	const hit = new RegExp(`--${name}:\\s*(#[0-9a-f]{3,8})`, 'i').exec(block);
	if (!hit) throw new Error(`--${name} is not defined for ${theme}`);
	return hit[1];
}

describe('location row colours', () => {
	// 4.5:1 is WCAG AA for normal text, and this row is 10.5px — small enough
	// that the large-text allowance (3:1) does not apply to it.
	const AA = 4.5;

	for (const theme of ['light', 'dark'] as const) {
		for (const name of ['path', 'branch', 'ahead', 'behind']) {
			it(`--${name} is readable on the ${theme} page`, () => {
				const ratio = contrastRatio(token(name, theme), token('page', theme));
				expect(
					ratio,
					`--${name} on --page (${theme}) = ${ratio.toFixed(2)}:1`
				).toBeGreaterThanOrEqual(AA);
			});
		}
	}

	it('does not reuse a status colour, which would mean two things at once', () => {
		// --working and --done say "this agent is working / has finished"
		// everywhere else. A path is not a status.
		for (const theme of ['light', 'dark'] as const) {
			const status = [token('working', theme), token('done', theme)];
			for (const name of ['path', 'branch']) {
				expect(status, `--${name} (${theme})`).not.toContain(token(name, theme));
			}
		}
	});
});

describe('code surface', () => {
	it('is opaque, so it does not take the colour of a bubble behind it', () => {
		// Every code background used to be `color-mix(currentColor N%,
		// transparent)`. Translucent means it shows whatever is behind it, and
		// inside a harness-filled bubble that is orange.
		for (const theme of ['light', 'dark'] as const) {
			expect(token('code-bg', theme)).toMatch(/^#[0-9a-f]{6}$/i);
		}
	});

	it('carries its own ink, readable on itself', () => {
		// The trap: inside a harness fill the inherited colour is BLACK, which
		// is right on orange and invisible on the dark code surface. Code has
		// to set its own, and that pair has to work.
		for (const theme of ['light', 'dark'] as const) {
			const ratio = contrastRatio(token('code-ink', theme), token('code-bg', theme));
			expect(
				ratio,
				`code ink on code bg (${theme}) = ${ratio.toFixed(2)}:1`
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('reads as a panel against the page it sits on', () => {
		for (const theme of ['light', 'dark'] as const) {
			expect(contrastRatio(token('code-bg', theme), token('page', theme)), theme).toBeGreaterThan(
				1.05
			);
		}
	});
});
