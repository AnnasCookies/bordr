import type { Page } from '@playwright/test';

/**
 * Refuse the Herdr tab viewport lease for this page.
 *
 * A lease resizes the owner's REAL terminals to this browser's grid, and any
 * pane opened at the suite's 390px viewport claims one (see `tabViewport` in
 * the pane page). Without this, every live test that opens a pane would
 * squeeze real agent tabs to phone width while it runs. 501 is what a herdr
 * without the `tab.viewport` API answers, and the client stops asking after it.
 *
 * A test that exercises the lease opts back in with `page.unroute`, or routes
 * its own fake, which Playwright tries before this one.
 *
 * Not named `*.e2e.ts`, so Playwright does not collect it as a test file.
 */
export async function refuseViewportLeases(page: Page): Promise<void> {
	await page.route('**/api/geometry', (route) =>
		route.fulfill({
			status: 501,
			json: { message: 'the e2e suite stubs tab viewport leases off for this test' }
		})
	);
}
