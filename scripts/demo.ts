#!/usr/bin/env bun
/**
 * Record the README demo GIF against the invented data in `demo-data.ts`.
 *
 * Playwright records webm; ffmpeg converts it with a generated palette, which
 * is what keeps a screen recording legible rather than dithered to mush.
 *
 * Usage: bun run scripts/demo.ts [url] [outFile]
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:7682';
const out = process.argv[3] ?? '.github/media/demo.gif';
const raw = '.github/media/.raw';
mkdirSync(raw, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 402, height: 800 },
	deviceScaleFactor: 1,
	colorScheme: 'light',
	hasTouch: true,
	recordVideo: { dir: raw, size: { width: 402, height: 800 } }
});
const page = await context.newPage();
const { stub } = await import('./demo-data');
await stub(page);

const beat = (ms = 900) => page.waitForTimeout(ms);

await page.goto(`${url}/`, { waitUntil: 'networkidle' });
await beat(1400);

// Answer the blocked agent from the list, which is the whole point of bordr.
await page.getByRole('button', { name: /Rename it and write a migration/ }).click();
await beat();

// Open it and show the conversation, picker card and key strip.
await page.locator('main a[href="/a/w1:p1"]').first().click();
await beat(1600);

// Swipe to the next agent.
await page.evaluate(() => {
	const target = document.querySelector('main') as HTMLElement;
	const fire = (type: string, cx: number) => {
		const touch = new Touch({ identifier: 1, target, clientX: cx, clientY: 430 });
		target.dispatchEvent(
			new TouchEvent(type, {
				touches: type === 'touchend' ? [] : [touch],
				changedTouches: [touch],
				bubbles: true
			})
		);
	};
	fire('touchstart', 150);
	fire('touchend', 310);
});
await beat(1400);

// Back to the list, then dark mode, to show the theme switch. Tab-bar taps,
// not goto: a full load shows the skeleton for half a second, which reads as
// a glitch in the GIF, whereas a client-side navigation is instant.
await page.goBack();
await beat(1000);
await page.getByRole('link', { name: 'Settings' }).click();
await beat(600);
await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click();
await beat(700);
await page.getByRole('link', { name: 'Agents' }).click();
await beat(1600);

await page.close();
await context.close();
await browser.close();

const webm = readdirSync(raw).find((f) => f.endsWith('.webm'));
if (!webm) throw new Error('playwright produced no video');

// A generated palette, not the default 216-colour web palette: without it the
// flat UI colours band badly and the text stops being readable.
//
// -ss skips the lead-in. Playwright records from the moment the context opens,
// so the first second of the webm is a white page and the loading skeleton,
// which on a looping GIF is a flash of white every time it wraps round.
execFileSync(
	'ffmpeg',
	[
		'-y',
		'-ss',
		'1.2',
		'-i',
		join(raw, webm),
		'-vf',
		'fps=12,scale=340:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
		'-loop',
		'0',
		out
	],
	{ stdio: 'pipe' }
);
rmSync(raw, { recursive: true, force: true });
console.log(`wrote ${out}`);
