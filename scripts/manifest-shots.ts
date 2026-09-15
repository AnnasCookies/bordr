#!/usr/bin/env bun
/**
 * The screenshots the install dialog shows, in both shapes it asks for.
 *
 * Chrome's richer install UI — the card with the app's own pictures on it,
 * rather than a bare name and icon — appears only when the manifest carries a
 * screenshot for the form factor being installed to. Desktop reads `wide` and
 * ignores everything else; Android reads `narrow` and ignores `wide`. One
 * shape means half the installs get the plain dialog.
 *
 * Same invented data as the README shots, for the same reason: these files go
 * into `static/` and are served to anyone who can reach the app, so no real
 * workspace name, directory or transcript may appear in them.
 *
 * Chrome's constraints, which this script satisfies by construction:
 *   - 320px to 3840px on each side
 *   - the long side at most 2.3x the short one
 *   - every screenshot of one form factor sharing an aspect ratio
 *   - PNG or JPEG
 *
 * Usage: bun run scripts/manifest-shots.ts [url] [outDir]
 */
import { chromium } from '@playwright/test';
import { stub } from './demo-data';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:7682';
const outDir = process.argv[3] ?? 'static/shots';
mkdirSync(outDir, { recursive: true });

/** 1.99 and 1.78 — both inside the 2.3 ceiling, both well over 320px. */
const SHAPES = {
	narrow: { width: 402, height: 800 },
	wide: { width: 1280, height: 720 }
} as const;

/**
 * Drop whatever this build happens to be saying at the moment of capture.
 *
 * A deploy during a capture run put "bordr has updated · tap to reload" across
 * the top of the first attempt at these — a true banner about a build nobody
 * installing the app will ever have seen, welded into the install dialog for
 * good.
 */
async function hideTransient(page: import('@playwright/test').Page): Promise<void> {
	await page.evaluate(() => {
		for (const node of document.querySelectorAll('button, [role="status"]')) {
			if (/bordr has updated/i.test(node.textContent ?? '')) node.remove();
		}
	});
}

const browser = await chromium.launch();

for (const [factor, viewport] of Object.entries(SHAPES)) {
	const page = await browser.newPage({
		viewport,
		deviceScaleFactor: 2,
		// One scheme only. A light and a dark shot of the same screen are two
		// pictures of one thing in a dialog that shows at most a handful, and
		// dark is what bordr is mostly looked at in.
		colorScheme: 'dark',
		ignoreHTTPSErrors: true
	});
	await stub(page);

	await page.goto(`${url}/`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(700);
	await hideTransient(page);
	await page.screenshot({ path: `${outDir}/agents-${factor}.png` });

	// Client-side, like the README script: `+page.ts` runs on the server for a
	// fresh load and Playwright cannot intercept a server-side fetch, so a
	// direct goto renders a real 404 from the real server.
	await page.locator('main a[href="/a/w1:p1"]').first().click();
	await page.waitForTimeout(900);
	await hideTransient(page);
	await page.screenshot({ path: `${outDir}/conversation-${factor}.png` });

	await page.close();
	console.error(`manifest-shots: ${factor} ${viewport.width}x${viewport.height} -> ${outDir}`);
}

await browser.close();
