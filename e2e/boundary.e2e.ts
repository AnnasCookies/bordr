import { expect, test } from '@playwright/test';

/**
 * The request-side boundary in src/hooks.server.ts, exercised against the
 * real adapter rather than reasoned about: what a browser on the same origin
 * sends must pass, and the three shapes an attacker can produce must not.
 */

const PANE = 'nope:nope';
const IMAGE = {
	file: { name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') }
};

test('a same-origin multipart POST over plain HTTP is not refused as cross-site', async ({
	request,
	baseURL
}) => {
	// svelte-adapter-bun assumes https when nothing tells it otherwise, and
	// SvelteKit's built-in check compared full origins, so on a plain-HTTP run
	// every photo upload came back 403. The hook compares hosts instead.
	const response = await request.post(`/api/agents/${PANE}/image`, {
		headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin' },
		multipart: IMAGE
	});
	expect(response.status()).not.toBe(403);
	// 409 when herdr is up and says the pane does not exist; 5xx when it is not.
	expect([409, 500, 503]).toContain(response.status());
});

test('an Origin on another host is refused, whatever Sec-Fetch-Site claims', async ({
	request
}) => {
	const response = await request.post(`/api/agents/${PANE}/keys`, {
		headers: { origin: 'http://evil.example', 'sec-fetch-site': 'same-origin' },
		data: { keys: ['enter'] }
	});
	expect(response.status()).toBe(403);
});

test('a sandboxed artifact (opaque origin) cannot reach a writing route', async ({ request }) => {
	// A sandboxed iframe sends the literal "null" as Origin and cross-site as
	// Sec-Fetch-Site. Either alone must be enough.
	const byOrigin = await request.post(`/api/agents/${PANE}/keys`, {
		headers: { origin: 'null' },
		data: { keys: ['enter'] }
	});
	expect(byOrigin.status()).toBe(403);
	const bySite = await request.post(`/api/agents/${PANE}/keys`, {
		headers: { 'sec-fetch-site': 'cross-site' },
		data: { keys: ['enter'] }
	});
	expect(bySite.status()).toBe(403);
});

test('a Host bordr was not told to serve gets 421, even for a GET', async ({ request }) => {
	// DNS rebinding: the attacker's own name resolving to bordr's address.
	const response = await request.get('/api/agents', {
		headers: { host: 'evil.example' }
	});
	expect(response.status()).toBe(421);
	expect(await response.text()).toContain('BORDR_ALLOWED_HOSTS');
});

test('the app shell still answers on its own host', async ({ request }) => {
	const response = await request.get('/');
	expect(response.status()).toBe(200);
});
