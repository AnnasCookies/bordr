import { expect, test } from '@playwright/test';

test('a long draft does not sit under the scrollbar', async ({ page }) => {
	await page.goto('/');
	const link = page.locator('main a[href^="/a/"]').first();
	await link.waitFor({ state: 'attached' });
	await page.goto((await link.getAttribute('href')) as string);

	const box = page.getByPlaceholder(/Type a reply|Or type a reply|Runs on the host/);
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
