import { expect, test } from '@playwright/test';

test('files lists roots, walks into one, and offers Download and Share per row', async ({
	page
}) => {
	await page.goto('/f');
	const firstRoot = page.locator('main a[href^="/f/"]').first();
	await expect(firstRoot).toBeVisible();
	await firstRoot.click();

	// Either the directory has files (each with both actions) or it is empty.
	const rows = page.locator('main li');
	await expect(rows.first()).toBeVisible();
	const downloads = page.getByRole('link', { name: /^Download / });
	const shares = page.getByRole('button', { name: /^Share / });
	expect(await downloads.count()).toBe(await shares.count());
});

test('download links carry the attachment flag, and never the browse route', async ({ page }) => {
	await page.goto('/f');
	// Walk down until a directory with files is found: the first root is often
	// only sub-directories, and skipping the test proves nothing.
	for (let depth = 0; depth < 4; depth++) {
		if ((await page.getByRole('link', { name: /^Download / }).count()) > 0) break;
		const into = page.locator('main a[href^="/f/"]').first();
		if ((await into.count()) === 0) break;
		await into.click();
		await page.waitForLoadState('networkidle');
	}
	const download = page.getByRole('link', { name: /^Download / }).first();
	await expect(download).toBeAttached();
	const href = await download.getAttribute('href');
	expect(href).toMatch(/^\/raw\//);
	expect(href).toContain('dl=1');
});

test('the raw route refuses to escape its root', async ({ request }) => {
	// A bare /raw/ only earns a trailing-slash redirect, so follow it and judge
	// where it lands rather than treating the 308 itself as a pass or a fail.
	for (const path of [
		'/raw/dev/../package.json',
		'/raw/dev/%2e%2e/package.json',
		'/raw/dev/..%2Fpackage.json',
		'/raw/dev/../../etc/passwd',
		'/raw/nope/whatever',
		'/raw/',
		'/raw/dev/.env'
	]) {
		const response = await request.get(path);
		expect(response.status(), path).toBeGreaterThanOrEqual(400);
	}
});

/**
 * The viewer frames artifacts from /raw. `x-frame-options: DENY` there renders
 * as the browser's broken-page face — which is exactly what happened when byte
 * serving moved routes and the header exemption did not move with it.
 */
test('artifacts are framable, and the browse page still is not', async ({ request }) => {
	const artifact = await request.get('/raw/dev/collie.svg');
	expect(artifact.status()).toBe(200);
	expect(artifact.headers()['x-frame-options']).toBeUndefined();
	expect(artifact.headers()['content-security-policy']).toContain('sandbox');

	const page = await request.get('/f/dev');
	expect(page.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
});

test('an html artifact actually renders in the viewer iframe', async ({ page }) => {
	await page.goto('/f/dev');
	const link = page.locator('main a[href$=".svg"], main a[href$=".html"]').first();
	if ((await link.count()) === 0) test.skip(true, 'no artifact in static/');
	await link.click();
	const frame = page.locator('iframe');
	await expect(frame).toBeVisible();
	// A blocked frame yields no document at all.
	await expect(async () => {
		const content = await frame.contentFrame();
		expect(content).not.toBeNull();
		expect(await content!.locator('svg, body').first().count()).toBeGreaterThan(0);
	}).toPass({ timeout: 8000 });
});
