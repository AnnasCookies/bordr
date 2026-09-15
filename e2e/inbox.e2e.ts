import { expect, test } from '@playwright/test';
import { openSettings } from './settings';

test('inbox lists agents and never scrolls horizontally', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'bordr' })).toBeVisible();

	// A deep cwd in a group header used to push the page sideways.
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth
	);
	expect(overflow).toBe(false);
});

test('the tab bar reaches every screen', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: 'Search', exact: true }).click();
	await expect(page.getByPlaceholder('Search all sessions…')).toBeVisible();
	await page.getByRole('link', { name: 'Agents', exact: true }).click();

	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('grouping modes all render, and each pane appears exactly once', async ({ page }) => {
	await openSettings(page, 'agents list');
	for (const mode of ['Workspace', 'Status', 'Harness', 'None']) {
		// Scoped: "Status" is also an option under Sort within group.
		await page
			.getByRole('group', { name: 'Group by' })
			.getByRole('button', { name: mode, exact: true })
			.click();
		await page.goto('/');
		// Wait for the first SSE event: asserting uniqueness over an empty list
		// would pass without proving anything.
		await page.locator('main a[href^="/a/"]').first().waitFor({ state: 'attached' });
		// One link per ROW: a blocked row with a long picker also carries an
		// "Open" link to the same conversation, which is not a duplicate row.
		const hrefs = await page
			.locator('main li')
			.evaluateAll((rows) =>
				rows
					.map((row) => row.querySelector('a[href^="/a/"]')?.getAttribute('href') ?? null)
					.filter((href): href is string => href !== null)
			);
		expect(hrefs.length, `no rows rendered in ${mode} mode`).toBeGreaterThan(0);
		expect(new Set(hrefs).size, `duplicate rows in ${mode} mode`).toBe(hrefs.length);
		await openSettings(page, 'agents list');
	}
});

test('theme switch paints the page and survives a reload', async ({ page }) => {
	await openSettings(page, 'appearance');
	await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click();
	await expect(page.locator('html')).toHaveClass(/dark/);
	await page.reload();
	await expect(page.locator('html')).toHaveClass(/dark/);
	await openSettings(page, 'appearance');

	await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Light' }).click();
	await expect(page.locator('html')).not.toHaveClass(/dark/);
});
