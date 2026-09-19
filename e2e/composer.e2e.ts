import { expect, test } from '@playwright/test';
import { refuseViewportLeases } from './leases';

// Opening a pane at phone width would otherwise resize a real herdr tab.
test.beforeEach(({ page }) => refuseViewportLeases(page));

test('a long draft does not sit under the scrollbar', async ({ page }) => {
	await page.goto('/');
	const link = page.locator('main a[href^="/a/"]').first();
	await link.waitFor({ state: 'attached' });
	await page.goto((await link.getAttribute('href')) as string);

	// By its name, not its placeholder: the placeholder moves with the pane's
	// state — "Runs on the host…" for a shell, "Type into the question…" when a
	// picker is on screen — so matching it made the test depend on which agent
	// happened to be first in the list and what it was doing.
	const box = page.getByRole('textbox', { name: 'Message' });
	await box.fill(Array.from({ length: 14 }, (_, i) => `line ${i} of a long draft`).join('\n'));

	const m = await box.evaluate((el) => {
		const s = getComputedStyle(el);
		return {
			paddingRight: parseFloat(s.paddingRight),
			scrolls: (el as HTMLTextAreaElement).scrollHeight > el.clientHeight
		};
	});
	expect(m.scrolls, 'the draft should be long enough to scroll').toBe(true);
	expect(m.paddingRight, 'text needs room beside an overlay scrollbar').toBeGreaterThanOrEqual(6);
});
