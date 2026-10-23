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
import { randomBytes, timingSafeEqual } from 'node:crypto';
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
 *
 * The socket's file permissions are its access control, and an open
 * loopback port would hand that to every local user for as long as the run
 * lasts. So a connection is piped only once its first request carries this
 * run's token, which lives in this process's memory and nowhere else: not
 * argv, not the environment, not a file. Anything else is refused before
 * the socket is ever dialled.
 */
const TOKEN_HEADER = 'x-bordr-smoke';
const HEADERS_MAX = 64 * 1024;

function forward(socketPath: string, token: string): { url: string; stop: () => void } {
	type Link = {
		head: Buffer;
		upstream?: Bun.Socket<undefined>;
		queued: Uint8Array[];
		open: boolean;
	};
	const expected = Buffer.from(token);

	function admitted(head: Buffer): boolean {
		for (const line of head.toString('latin1').split('\r\n').slice(1)) {
			const colon = line.indexOf(':');
			if (colon < 0 || line.slice(0, colon).trim().toLowerCase() !== TOKEN_HEADER) continue;
			const offered = Buffer.from(line.slice(colon + 1).trim());
			return offered.length === expected.length && timingSafeEqual(offered, expected);
		}
		return false;
	}

	function dial(client: Bun.Socket<Link>) {
		client.data.open = true;
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
	}

	const server = Bun.listen<Link>({
		hostname: '127.0.0.1',
		port: 0,
		socket: {
			open(client) {
				client.data = { head: Buffer.alloc(0), queued: [], open: false };
			},
			data(client, chunk) {
				const bytes = new Uint8Array(chunk);
				if (client.data.open) {
					if (client.data.upstream) client.data.upstream.write(bytes);
					else client.data.queued.push(bytes);
					return;
				}
				// Gate on the first request's headers only: later requests on a
				// kept-alive connection come from the client that already proved it.
				const head = Buffer.concat([client.data.head, bytes]);
				const end = head.indexOf('\r\n\r\n');
				if (end < 0) {
					if (head.length > HEADERS_MAX) client.end();
					else client.data.head = head;
					return;
				}
				if (!admitted(head.subarray(0, end))) {
					client.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
					return;
				}
				client.data.queued.push(head);
				client.data.head = Buffer.alloc(0);
				dial(client);
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
const token = randomBytes(32).toString('hex');
const proxy = socketPath ? forward(socketPath, token) : null;
const url = process.argv[2] || process.env.BORDR_URL || proxy?.url || 'http://127.0.0.1:7682/';
const label = socketPath ? `${socketPath} via ${url}` : url;
const failures: string[] = [];
const problems: string[] = [];

const browser = await chromium.launch();
const page = await browser.newPage({
	ignoreHTTPSErrors: true,
	// Only the forwarder reads it; a direct BORDR_URL run sends nothing extra.
	...(proxy && { extraHTTPHeaders: { [TOKEN_HEADER]: token } })
});

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
