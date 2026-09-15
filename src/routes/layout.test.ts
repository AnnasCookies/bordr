import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read from the stylesheet itself: a copy of the selectors here would keep
 * passing after someone edited the real rule.
 */
const CSS = readFileSync(join(import.meta.dirname, 'layout.css'), 'utf8');

/** The selector list of the `:active` rule inside `@media (hover: none)`. */
function touchPressSelectors(): string[] {
	const start = CSS.indexOf('@media (hover: none)');
	if (start < 0) throw new Error('no (hover: none) block in layout.css');
	const open = CSS.indexOf('{', start);
	const rule = CSS.indexOf('{', open + 1);
	return CSS.slice(open + 1, rule)
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

describe('touch press feedback', () => {
	/**
	 * The drawers' scrims are full-bleed buttons marked `.no-press`. A rule
	 * that dims every `:active` button on a touch screen without honouring
	 * that class dims the whole overlay on every tap that closes it.
	 */
	it('never dims a .no-press element', () => {
		const selectors = touchPressSelectors();
		expect(selectors.length).toBeGreaterThan(0);
		for (const selector of selectors) {
			expect(selector, selector).toContain(':not(.no-press)');
		}
	});

	it('never dims a disabled control', () => {
		const selectors = touchPressSelectors();
		const button = selectors.find((s) => s.startsWith('button'));
		const roleButton = selectors.find((s) => s.startsWith("[role='button']"));
		expect(button).toContain(':not(:disabled)');
		expect(roleButton).toContain(":not([aria-disabled='true'])");
	});
});
