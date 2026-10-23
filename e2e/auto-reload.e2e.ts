import { expect, test, type Page } from '@playwright/test';

/**
 * A deploy reloads an idle page by itself; a page with something to lose
 * keeps the banner. The new build is faked by answering SvelteKit's version
 * poll with a version this build is not.
 */
async function staleSettings(page: Page) {
	await page.clock.install();
	await page.route('**/_app/version.json', (route) =>
		route.fulfill({ json: { version: 'a-newer-build' } })
	);
	await page.goto('/settings');
	// The layout re-checks the version whenever the page comes back into view.
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect(page.getByRole('button', { name: /bordr has updated/ })).toBeVisible();
	await page.evaluate(() => ((window as unknown as { marker: boolean }).marker = true));
}

// IDLE_MS in $lib/reload-guard.svelte.ts. A runes module cannot be imported
// outside the Svelte compiler, so it is restated here.
const IDLE_MS = 60_000;

const marked = (page: Page) =>
	page.evaluate(() => (window as unknown as { marker?: boolean }).marker === true);

test('an idle stale page loads the new build without a tap', async ({ page }) => {
	await staleSettings(page);
	const reloaded = page.waitForEvent('load');
	await page.clock.fastForward(IDLE_MS + 6_000);
	await reloaded;
	expect(await marked(page)).toBe(false);
});

test('a page being typed into keeps the banner instead', async ({ page }) => {
	await staleSettings(page);
	await page.evaluate(() => {
		const field = document.createElement('input');
		document.body.append(field);
		field.focus();
	});
	await page.clock.fastForward(IDLE_MS + 6_000);
	expect(await marked(page)).toBe(true);
	await expect(page.getByRole('button', { name: /bordr has updated/ })).toBeVisible();
});
