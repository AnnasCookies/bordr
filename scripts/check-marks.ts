/**
 * Does every hand-converted mark actually fit the viewBox it is cropped to?
 *
 * A mark taken from a logo keeps the source's coordinates and is cropped with
 * a viewBox rather than rescaled, so the box is the one number that can be
 * wrong — and a wrong one silently slices the glyph rather than failing. grok
 * shipped that way. Chromium measures the path; nothing else here can.
 *
 *   bun run scripts/check-marks.ts
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const src = readFileSync('src/lib/harness-marks.ts', 'utf8');
// Every mark in the file, measured — the grok crop was wrong by guesswork, so
// check the rest the same way rather than trusting them.
const marks = [
	...src.matchAll(
		/(\w+): \{\s*d:\s*((?:'[^']*'(?:\s*\+\s*)?)+),?\s*(?:evenodd: true,?\s*)?(?:box: '([^']*)')?/g
	)
];
const b = await chromium.launch();
const p = await b.newPage();
for (const m of marks) {
	const d = m[2]
		.split('+')
		.map((s) => s.trim().slice(1, -1))
		.join('');
	const box = m[3] ?? '0 0 24 24';
	await p.setContent(`<svg viewBox="${box}"><path id="p" d="${d}"/></svg>`);
	const r = await p.evaluate(() => {
		const x = document.getElementById('p').getBBox();
		return [x.x, x.y, x.width, x.height].map((n) => +n.toFixed(1));
	});
	const [bx, by, bw, bh] = box.split(' ').map(Number);
	const inside =
		r[0] >= bx - 0.5 &&
		r[1] >= by - 0.5 &&
		r[0] + r[2] <= bx + bw + 0.5 &&
		r[1] + r[3] <= by + bh + 0.5;
	if (!inside) process.exitCode = 1;
	console.log(
		`${m[1].padEnd(6)} box ${box.padEnd(15)} ink ${JSON.stringify(r).padEnd(24)} ${inside ? 'fits' : 'CLIPPED'}`
	);
}
await b.close();

if (process.exitCode) console.error('a mark does not fit its box — fix the box, not the path');
