#!/usr/bin/env bun
/**
 * Capture the README screenshots against INVENTED data.
 *
 * Never point this at a real herdr: the agents list shows workspace names,
 * working directories and transcript text, none of which belongs in a public
 * repository. Every string below is made up, so the images are reproducible by
 * anyone and leak nothing.
 *
 * Usage: bun run scripts/screenshots.ts [url] [outDir]
 */
import { chromium } from '@playwright/test';
import { stub } from './demo-data';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:7682';
const outDir = process.argv[3] ?? '.github/media';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const scheme of ['light', 'dark'] as const) {
	const page = await browser.newPage({
		viewport: { width: 402, height: 800 },
		deviceScaleFactor: 2,
		colorScheme: scheme,
		ignoreHTTPSErrors: true
	});
	await stub(page);

	await page.goto(`${url}/`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(700);
	await page.screenshot({ path: `${outDir}/agents-${scheme}.png` });

	// Navigate CLIENT-SIDE. `+page.ts` runs on the server for a fresh load, and
	// Playwright cannot intercept a server-side fetch, so a direct goto rendered
	// a genuine 404 from the real server.
	await page.locator('main a[href="/a/w1:p1"]').first().click();
	await page.waitForTimeout(900);
	await page.screenshot({ path: `${outDir}/conversation-${scheme}.png` });

	// The session drawer, which is how you move between machines and panes.
	await page.getByRole('button', { name: 'Session list', exact: true }).click();
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${outDir}/drawer-${scheme}.png` });
	// Home, from inside the drawer: the conversation has a composer where the
	// tab bar is, so the list is the only way back to the other screens.
	await page.getByRole('link', { name: 'Home — all agents' }).click();
	await page.waitForTimeout(700);

	// EVERY navigation from here is client-side, through the tab bar. A goto or
	// a reload re-runs the universal load ON THE SERVER, and a server-side
	// fetch cannot be intercepted — the settings shot used to come back
	// carrying the host's real workspace names and a real spend figure, off
	// its own herdr, straight into a public README.
	await page.getByRole('link', { name: 'Files' }).click();
	await page.waitForTimeout(700);
	await page.screenshot({ path: `${outDir}/files-${scheme}.png` });

	await page.getByRole('link', { name: 'Settings' }).click();
	await page.waitForTimeout(700);
	// At this width every group starts closed, and a page of closed headings
	// shows nothing Settings does; open the one with the live previews.
	await page.locator('details[data-section="appearance"] > summary').click();
	await page.waitForTimeout(300);
	await page.screenshot({ path: `${outDir}/settings-${scheme}.png` });

	// Terminal mode is chosen in Settings, so switch it there and walk back.
	await page.locator('details[data-section="workspaces & panes"] > summary').click();
	await page.waitForTimeout(300);
	await page
		.getByRole('group', { name: 'Pane view' })
		.getByRole('button', { name: 'Terminal' })
		.click();
	await page.waitForTimeout(300);
	await page.getByRole('link', { name: 'Agents' }).click();
	await page.waitForTimeout(700);
	await page.locator('main a[href="/a/w1:p1"]').first().click();
	await page.waitForTimeout(1100);
	await page.screenshot({ path: `${outDir}/terminal-${scheme}.png` });

	await page.close();
	console.log(`captured ${scheme}`);
}
await browser.close();
