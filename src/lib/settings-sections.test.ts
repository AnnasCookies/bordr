import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTED, SECTIONS } from './settings-sections';

/**
 * The nav lists the sections; the page renders them. They are two files, so
 * they can drift — and the failure is silent and one-directional: a nav entry
 * for a section that no longer exists gives you a link that lights up and
 * shows an empty pane, with nothing to say why.
 *
 * Read out of the page rather than copied from it, so this fails when someone
 * renames a heading and forgets the nav.
 */
const page = readFileSync(
	join(import.meta.dirname, '..', 'routes', 'settings', '+page.svelte'),
	'utf8'
);

describe('settings sections', () => {
	it('guards every section the page renders, in order', () => {
		// Each section is wrapped in `{#if shown('<key>')}`.
		const guarded = [...page.matchAll(/\{#if shown\('([^']+)'\)\}/g)].map((m) => m[1]);
		expect(guarded).toEqual([...SECTIONS]);
	});

	it('names each guard after the heading it wraps', () => {
		// `&` is written `&amp;` in the markup; the key is the plain text.
		const headings = [...page.matchAll(/<SettingsSection heading="([^"]+)">/g)].map((m) =>
			m[1].trim().replace(/&amp;/g, '&')
		);
		// Routed sections have no heading of their own — each is a single link
		// out to its own route.
		expect(headings).toEqual(SECTIONS.filter((s) => !ROUTED.includes(s)));
	});
});
