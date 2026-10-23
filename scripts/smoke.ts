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
 *
 * With no url and no BORDR_URL, the target is whatever the installed unit
 * serves. A unit on SOCKET_PATH has no TCP port at all, and the old default
 * of 127.0.0.1:7682 failed every such deploy with "connection refused" after
 * the restart had in fact succeeded.
 */
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

/** SOCKET_PATH from the installed unit, system manager first like restart-service.sh. */
function unitSocket(service: string): string | null {
	for (const manager of ['--system', '--user']) {
		const shown = spawnSync(
			'systemctl',
			[manager, 'show', service, '-p', 'Environment', '--value'],
			{
				encoding: 'utf8'
			}
		);
		if (shown.status !== 0) continue;
		const match = /(?:^|\s)SOCKET_PATH=(\S+)/.exec(shown.stdout);
		if (match) return match[1];
	}
	return null;
}

/**
 * A loopback TCP port piped byte-for-byte into the socket.
 *
 * Playwright cannot dial a Unix socket. The browser then sends Host and
 * Origin as 127.0.0.1:<port>, which the server accepts as loopback and as
 * same-origin, so the write probe below still exercises the CSRF check.
 */
function forward(socketPath: string): { url: string; stop: () => void } {
	type Link = { upstream?: Bun.Socket<undefined>; queued: Uint8Array[] };
	const server = Bun.listen<Link>({
		hostname: '127.0.0.1',
		port: 0,
		socket: {
			open(client) {
				client.data = { queued: [] };
				Bun.connect({
					unix: socketPath,
					socket: {
						open(upstream) {
							client.data.upstream = upstream;
							for (const chunk of client.data.queued) upstream.write(chunk);
							client.data.queued = [];
						},
						data(_upstream, chunk) {
							client.write(chunk);
						},
						close() {
							client.end();
						},
						error() {
							client.end();
						}
					}
				}).catch((e) => {
					console.error(`  ! cannot reach ${socketPath}: ${(e as Error).message}`);
					client.end();
				});
			},
			data(client, chunk) {
				if (client.data.upstream) client.data.upstream.write(chunk);
				else client.data.queued.push(new Uint8Array(chunk));
			},
			close(client) {
				client.data.upstream?.end();
			}
		}
	});
	return { url: `http://127.0.0.1:${server.port}/`, stop: () => server.stop(true) };
}

const socketPath =
	process.argv[2] || process.env.BORDR_URL
		? null
		: unitSocket(process.env.BORDR_SERVICE ?? 'bordr');
const proxy = socketPath ? forward(socketPath) : null;
const url = process.argv[2] || process.env.BORDR_URL || proxy?.url || 'http://127.0.0.1:7682/';
const label = socketPath ? `${socketPath} via ${url}` : url;
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

	// GETs skip the CSRF Origin check; a proxied Unix socket that rewrites
	// Host to localhost while the browser sends Origin: https://…:8444 passed
	// every navigation above and refused every write with 403.
	const writeProbe = await page.request.post(new URL('/api/read-state', url).toString(), {
		headers: {
			origin: new URL(url).origin,
			'sec-fetch-site': 'same-origin'
		},
		data: {}
	});
	if (writeProbe.status() !== 400) {
		failures.push(
			`same-origin POST /api/read-state returned ${writeProbe.status()} (expected 400)`
		);
	}
} catch (e) {
	failures.push(`page never became usable: ${(e as Error).message.split('\n')[0]}`);
}

await browser.close();
proxy?.stop();

for (const p of problems) console.log(`  ! ${p}`);
if (failures.length > 0) {
	console.log(`\nSMOKE FAILED (${label})`);
	for (const f of failures) console.log(`  ✗ ${f}`);
	process.exit(1);
}
console.log(
	`SMOKE PASSED (${label}) — page hydrated, agents rendered${problems.length ? `, ${problems.length} non-fatal console/network warning(s)` : ''}`
);
