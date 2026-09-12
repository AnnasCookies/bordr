import { expect, test } from '@playwright/test';

async function firstPane(page: import('@playwright/test').Page) {
	await page.goto('/');
	const link = page.locator('main a[href^="/a/"]').first();
	await link.waitFor({ state: 'attached' });
	return link.getAttribute('href');
}

test('the drawer offers an explicit way out and a way home', async ({ page }) => {
	const href = await firstPane(page);
	test.skip(!href, 'no agents running');
	await page.goto(href as string);

	await page.getByRole('button', { name: 'Session list', exact: true }).click();
	const close = page.getByRole('button', { name: 'Close the session list' });
	const home = page.getByRole('link', { name: 'All agents', exact: true });
	await expect(home).toBeVisible();
	await expect(close).toBeVisible();

	// 44px is the tap target this app holds itself to.
	const box = await close.boundingBox();
	expect(box!.height).toBeGreaterThanOrEqual(44);
	expect(box!.width).toBeGreaterThanOrEqual(44);

	await close.click();
	await expect(home).toBeHidden();
});

test('back returns to the agents list however much you moved around', async ({ page }) => {
	const href = await firstPane(page);
	test.skip(!href, 'no agents running');

	await page.goto('/');
	await page.locator('main a[href^="/a/"]').first().click();
	await expect(page).toHaveURL(/\/a\//);

	// Move between panes the way the drawer does, several times over.
	const panes = await page.evaluate(() =>
		[...document.querySelectorAll('a[href^="/a/"]')].map((a) => a.getAttribute('href'))
	);
	for (const p of panes.slice(0, 4)) {
		if (!p) continue;
		await page.locator(`a[href="${p}"]`).first().click();
		await page.waitForTimeout(250);
	}

	await page.goBack();
	await expect(page).toHaveURL(/\/$|\/\?/);
});
