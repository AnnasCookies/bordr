import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Read from the source rather than rendered: opening the sheet in a browser
 * needs a running agent that has spawned a sub-agent, which no test run can
 * count on, so an e2e check would skip exactly when it mattered.
 */
const source = readFileSync(join(import.meta.dirname, 'subagent-sheet.svelte'), 'utf8');
const scrim = source.match(/<button\b[^>]*bg-black\/40[^>]*>/)?.[0] ?? '';

describe('the sub-agent sheet scrim', () => {
	it('is still where this test looks for it', () => {
		expect(scrim, 'no scrim button found; update the pattern above').not.toBe('');
	});

	/** Every control shrinks on press; a full-screen overlay doing so is absurd. */
	it('opts out of the press', () => {
		expect(scrim).toMatch(/class="[^"]*\bno-press\b/);
	});

	/**
	 * The sheet's "close" is the labelled way out. A second named button for
	 * the same job is noise in the accessibility tree and a stop on the tab
	 * order, which is what the drawer scrims were already fixed for.
	 */
	it('is hidden from assistive technology and from focus', () => {
		expect(scrim).toContain('aria-hidden="true"');
		expect(scrim).toContain('tabindex="-1"');
		expect(scrim).not.toContain('aria-label');
	});
});
