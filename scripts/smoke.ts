#!/usr/bin/env bun
/**
 * Post-deploy smoke test: load the DEPLOYED page in a real browser and
 * assert it actually works.
 *
 * Exists because every server-side check can pass while the app is broken.
 * A build that left stale asset hashes in the HTML returned 200 for the
 * document, 200 for the API and 200 for the SSE stream, while every JS
 * bundle 500'd — so the page never hydrated and sat on "reconnecting"
 * forever. curl could not see it; a browser sees it immediately.
 *
 * Usage: bun run scripts/smoke.ts [url]
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? process.env.BORDR_URL ?? 'http://127.0.0.1:7682/';
const failures: string[] = [];
const problems: string[] = [];

const browser = await chromium.launch();
const page = await browser.newPage({ ignoreHTTPSErrors: true });

page.on('response', (r) => {
	if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on('console', (m) => {
	if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
});

try {
	const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
	if (!response?.ok()) failures.push(`document returned ${response?.status()}`);

	// Hydration is the thing that actually broke: the store only populates
	// the list client-side, so rows prove the app booted. So does the empty
	// state, which is what a fresh machine with no agents shows.
	await page.waitForFunction(
		() =>
			document.querySelectorAll('ul li a').length > 0 ||
			/No agents running/i.test(document.body.innerText),
		{ timeout: 15_000 }
	);

	const connection = await page.locator('body').innerText();
	if (/unreachable|not running|not supported/i.test(connection)) {
		failures.push(`connection banner reports a fault: ${connection.split('\n').pop()}`);
	}

	// The inbox alone is not proof: every other route is lazy-loaded on the
	// server, and a process whose build directory was rewritten underneath it
	// served "/" from memory while answering 500 to everything else.
	for (const path of ['/settings', '/f', '/search']) {
		const target = new URL(path, url).toString();
		const r = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15_000 });
		if (!r?.ok()) failures.push(`${path} returned ${r?.status()}`);
	}
} catch (e) {
	failures.push(`page never became usable: ${(e as Error).message.split('\n')[0]}`);
}

await browser.close();

for (const p of problems) console.log(`  ! ${p}`);
if (failures.length > 0) {
	console.log(`\nSMOKE FAILED (${url})`);
	for (const f of failures) console.log(`  ✗ ${f}`);
	process.exit(1);
}
console.log(
	`SMOKE PASSED (${url}) — page hydrated, agents rendered${problems.length ? `, ${problems.length} non-fatal console/network warning(s)` : ''}`
);
