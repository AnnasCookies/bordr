import { expect, test } from '@playwright/test';
import { refuseViewportLeases } from './leases';

// Opening a pane at phone width would otherwise resize a real herdr tab.
test.beforeEach(({ page }) => refuseViewportLeases(page));

test('a tapped control presses, and a scrim does not', async ({ page }) => {
	await page.goto('/');
	await page.locator('main a[href^="/a/"]').first().waitFor({ state: 'attached' });

	// The scrim behind the drawer is a button only so a tap closes it.
	// Scaling the whole overlay would be absurd, so it opts out.
	await page.getByRole('button', { name: 'Workspaces', exact: true }).click();
	const scrim = page.locator('.no-press').first();
	await expect(scrim).toBeVisible();
	expect(await scrim.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
	await page.getByRole('button', { name: 'Close the session list' }).click();

	// A real control presses. Held down, so the :active rule is live when read.
	const tab = page.getByRole('link', { name: 'Search', exact: true });
	expect(await tab.evaluate((el) => getComputedStyle(el).transform), 'at rest').toBe('none');
	await tab.hover();
	await page.mouse.down();
	// The press transitions over 60ms; reading straight away catches it
	// mid-flight and the assertion becomes a coin toss.
	await page.waitForTimeout(150);
	const pressed = await tab.evaluate((el) => getComputedStyle(el).transform);
	await page.mouse.up();
	expect(pressed, 'pressed should be scaled').toMatch(/^matrix\(0\.9/);
});
