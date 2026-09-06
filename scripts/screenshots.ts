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

	await page.goto(`${url}/settings`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${outDir}/settings-${scheme}.png` });

	await page.close();
	console.log(`captured ${scheme}`);
}
await browser.close();
