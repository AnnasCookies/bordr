import type { Page } from '@playwright/test';

/**
 * Open Settings at the group holding the row you are about to use.
 *
 * On a phone — which is the viewport these tests run at — the groups are
 * collapsed, so a row inside one is not on the page until its group is open.
 * Clicking the summary rather than setting `open` from script, so the tests
 * reach their rows the way a reader does.
 *
 * Not named `*.e2e.ts`, so Playwright does not collect it as a test file.
 */
export async function openSettings(page: Page, section: string): Promise<void> {
	await page.goto('/settings');
	const group = page.locator(`details[data-section="${section}"]`);
	// Desktop holds its one group open and has no disclosure to click.
	if (await group.evaluate((el: HTMLDetailsElement) => el.open)) return;
	await group.locator('summary').click();
}
