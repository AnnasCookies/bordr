import { expect, test } from '@playwright/test';

test('file markdown cannot borrow inline or application layout styles', async ({ page }) => {
	await page.goto('/f/fixture/report/notes.md');
	const action = page.getByRole('link', { name: 'Fixture action' });
	await expect(action).toBeVisible();
	await expect(action).not.toHaveAttribute('style');
	await expect(action).not.toHaveAttribute('class');
	await expect(page.getByText('Blocked script', { exact: true })).not.toHaveAttribute('href');
	await expect(page.locator('.bordr-md code')).toHaveClass('language-ts');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.getByRole('link', { name: 'Sibling note', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Sibling note', exact: true })).toBeVisible();
});

test('an unrelated site cannot execute an untokenised raw script', async ({ page, baseURL }) => {
	const scriptURL = new URL('/raw/fixture/secret.js', baseURL).href;
	await page.route('http://localhost:4191/', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: `<script src="${scriptURL}"></script>`
		})
	);
	// Bypass Chromium's separate local-network gate, not bordr's handler: the
	// production route supplies the actual bytes and MIME, then the browser
	// decides whether to execute them. This also makes the vulnerable control fail.
	let reached = false;
	await page.route(scriptURL, async (route) => {
		const response = await route.fetch({
			headers: { ...route.request().headers(), 'sec-fetch-site': 'cross-site' }
		});
		reached = true;
		expect(response.headers()['content-type']).toContain('text/plain');
		await route.fulfill({ response });
	});
	await page.goto('http://localhost:4191/');
	expect(reached).toBe(true);
	expect(await page.evaluate(() => 'fixtureLeaked' in window)).toBe(false);
});

test('viewer and Open raw preserve sibling assets but deny a parent script', async ({ page }) => {
	await page.goto('/f/fixture/report/index.html');
	const frame = page.frameLocator('iframe');
	await expect(frame.locator('#status')).toHaveText('sibling loaded');
	await expect(frame.locator('#status')).toHaveCSS('color', 'rgb(1, 2, 3)');
	expect(
		await page.locator('iframe').evaluate((element) => {
			try {
				return (element as HTMLIFrameElement).contentWindow?.document !== undefined;
			} catch {
				return false;
			}
		})
	).toBe(false);
	const href = await page.getByRole('link', { name: 'Open raw', exact: true }).getAttribute('href');
	expect(href).toMatch(/^\/raw\/~[A-Za-z0-9_-]{43}\//);
	await page.goto(href!);
	await expect(page.locator('#status')).toHaveText('sibling loaded');
	await expect(page.locator('#status')).toHaveCSS('color', 'rgb(1, 2, 3)');
	expect(await page.evaluate(() => 'fixtureLeaked' in window)).toBe(false);
});
