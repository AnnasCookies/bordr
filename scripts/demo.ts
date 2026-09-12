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
// Start with the agent working, so the question can arrive on camera.
const story = await stub(page, 'working');

/**
 * A pointer the recording can follow.
 *
 * Without one the GIF is a series of jump cuts: the screen changes and nothing
 * says what was pressed or why. A hand that travels to a target, settles, and
 * presses turns the same footage into something you can read. It lives in the
 * page rather than being drawn in afterwards, so it is always in step with
 * what is actually on screen.
 *
 * addInitScript, not an injected tag: it survives a navigation, and the
 * element is re-created if a client-side route swap ever tears it out.
 */
await page.addInitScript(() => {
	const install = () => {
		if (document.getElementById('demo-cursor')) return;
		const style = document.createElement('style');
		style.textContent = `
			#demo-cursor {
				position: fixed; left: 0; top: 0; z-index: 2147483647;
				width: 26px; height: 30px; pointer-events: none;
				transform: translate3d(200px, 700px, 0);
				transition: transform 460ms cubic-bezier(0.33, 0, 0.2, 1);
				filter: drop-shadow(0 2px 3px rgba(0,0,0,0.45));
			}
			#demo-cursor.press { transform: translate3d(var(--x), var(--y), 0) scale(0.86); transition: transform 110ms ease-out; }
			#demo-ring {
				position: fixed; left: 0; top: 0; z-index: 2147483646;
				width: 34px; height: 34px; margin: -17px 0 0 -17px;
				border-radius: 999px; pointer-events: none; opacity: 0;
				border: 2px solid rgba(37, 99, 235, 0.9);
				background: rgba(37, 99, 235, 0.18);
			}
			#demo-ring.go { animation: demo-ping 480ms ease-out; }
			@keyframes demo-ping {
				0% { opacity: 0.95; transform: translate3d(var(--x), var(--y), 0) scale(0.35); }
				100% { opacity: 0; transform: translate3d(var(--x), var(--y), 0) scale(1.5); }
			}`;
		document.head.append(style);

		const ring = document.createElement('div');
		ring.id = 'demo-ring';
		const hand = document.createElement('div');
		hand.id = 'demo-cursor';
		// A pointing hand, white on a dark outline so it reads on either theme.
		hand.innerHTML = `<svg viewBox="0 0 26 30" width="26" height="30">
			<path d="M8 2.5a2 2 0 0 1 4 0v10.5h1V9a2 2 0 0 1 4 0v4h1v-2.5a2 2 0 0 1 4 0V13h1v2.5a2 2 0 0 1-.4 1.2l-3.2 4.4a6 6 0 0 0-1.1 3.5V27a2 2 0 0 1-2 2h-6a2 2 0 0 1-1.8-1.1l-4.8-9a2 2 0 0 1 3.4-2L8 19z"
				fill="#ffffff" stroke="#111418" stroke-width="1.6" stroke-linejoin="round"/>
		</svg>`;
		document.body.append(ring, hand);
	};
	if (document.body) install();
	else document.addEventListener('DOMContentLoaded', install);

	// Called from the test side for every move and press.
	(window as unknown as Record<string, unknown>).__demo = {
		move(x: number, y: number) {
			const hand = document.getElementById('demo-cursor');
			const ring = document.getElementById('demo-ring');
			if (!hand || !ring) return;
			// The hand's point is its top-left; nudge so the fingertip lands on
			// the target rather than the palm.
			const hx = `${x - 6}px`;
			const hy = `${y - 3}px`;
			hand.style.setProperty('--x', hx);
			hand.style.setProperty('--y', hy);
			hand.style.transform = `translate3d(${hx}, ${hy}, 0)`;
			ring.style.setProperty('--x', `${x}px`);
			ring.style.setProperty('--y', `${y}px`);
			ring.style.transform = `translate3d(${x}px, ${y}px, 0)`;
		},
		press() {
			const hand = document.getElementById('demo-cursor');
			const ring = document.getElementById('demo-ring');
			if (!hand || !ring) return;
			hand.classList.add('press');
			ring.classList.remove('go');
			void ring.offsetWidth;
			ring.classList.add('go');
			setTimeout(() => hand.classList.remove('press'), 190);
		}
	};
});

const beat = (ms = 900) => page.waitForTimeout(ms);

/** Send the hand to an element's centre and wait out the travel. */
async function moveTo(target: import('@playwright/test').Locator, settle = 200) {
	// Scroll FIRST. `click()` scrolls the element into view itself, so measuring
	// before that moved the hand to where the target used to be and the press
	// landed somewhere else on screen — which is exactly the confusion the hand
	// exists to remove.
	await target.scrollIntoViewIfNeeded();
	await page.waitForTimeout(260);
	const box = await target.boundingBox();
	if (!box) throw new Error('nothing to point at');
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.evaluate(
		([px, py]) =>
			(window as never as { __demo: { move(a: number, b: number): void } }).__demo.move(px, py),
		[x, y] as const
	);
	// Matches the CSS transition; let it land before anything else happens.
	await page.waitForTimeout(460 + settle);
}

/** Point at something, press it, then actually click it. */
async function tap(target: import('@playwright/test').Locator, after = 700) {
	await moveTo(target);
	await page.evaluate(() => (window as never as { __demo: { press(): void } }).__demo.press());
	await page.waitForTimeout(150);
	await target.click();
	await beat(after);
}

await page.goto(`${url}/`, { waitUntil: 'networkidle' });
// Everything is just running. Nothing wants you yet.
await beat(1300);

// The agent hits a question it cannot answer for you. The reconnect carries
// it over within about a second, so it genuinely arrives on screen: the row
// lifts into "needs you" with its options already on it.
story.set('blocked');
await page.getByRole('button', { name: /Rename it and write a migration/ }).waitFor();
await beat(1200);

// The pitch: answered from the list, without opening anything.
await tap(page.getByRole('button', { name: /Rename it and write a migration/ }), 600);
story.set('answered');
// Wait for the reconnect to carry it, rather than guessing at a delay: the
// row leaving "needs you" IS the confirmation.
await page
	.getByRole('button', { name: /Rename it and write a migration/ })
	.waitFor({ state: 'hidden' });
await beat(1000);

// And it landed: the conversation carries your answer, and the card that was
// waiting on you has gone.
await tap(page.locator('main a[href="/a/w1:p1"]').first(), 1900);

// `/` lists the harness's own commands and your skills, with descriptions.
await tap(page.getByPlaceholder(/Type a reply|Or type a reply/), 400);
await page.keyboard.type('/', { delay: 120 });
await beat(1500);
await page.keyboard.press('Escape');
await beat(500);

// The panel: machines, workspaces, tabs and panes, herdr's own shape.
await tap(page.getByRole('button', { name: 'Session list', exact: true }), 1100);

// And back to the list from inside it.
await tap(page.getByRole('link', { name: 'Home — all agents' }), 800);

// Dark mode, because half the people looking at this will want to see it.
await tap(page.getByRole('link', { name: 'Settings' }), 550);
await tap(page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }), 900);
await tap(page.getByRole('link', { name: 'Agents' }), 1400);

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
		'fps=9,scale=300:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4',
		'-loop',
		'0',
		out
	],
	{ stdio: 'pipe' }
);
rmSync(raw, { recursive: true, force: true });
console.log(`wrote ${out}`);
