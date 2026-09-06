import { expect, test } from '@playwright/test';

/** The conversation needs a live pane; skip cleanly when none is running. */
async function firstPane(page: import('@playwright/test').Page): Promise<string | null> {
	await page.goto('/');
	// Rows arrive on the first SSE event, not with the document — querying
	// immediately found nothing and skipped every test in this file.
	const link = page.locator('main a[href^="/a/"]').first();
	try {
		await link.waitFor({ state: 'attached', timeout: 10_000 });
	} catch {
		return null;
	}
	return await link.getAttribute('href');
}

test('the key strip offers exactly the eight allowed keys, including enter', async ({ page }) => {
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);

	for (const key of ['esc', 'tab', 'up', 'down', 'left', 'right', 'space', 'enter']) {
		await expect(page.getByRole('button', { name: key, exact: true })).toBeVisible();
	}
});

test('Enter in the composer makes a newline instead of sending', async ({ page }) => {
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);

	const box = page.getByPlaceholder(/Type a reply|Or type a reply/);
	await box.fill('first line');
	await box.press('Enter');
	await box.type('second line');
	expect(await box.inputValue()).toBe('first line\nsecond line');
});

test('the conversation never scrolls horizontally', async ({ page }) => {
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth
	);
	expect(overflow).toBe(false);
});

test('the manual-controls button toggles the key strip', async ({ page }) => {
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);

	const esc = page.getByRole('button', { name: 'esc', exact: true });
	const toggle = page.getByRole('button', { name: 'Manual controls' });
	await expect(esc).toBeVisible();
	await toggle.click();
	await expect(esc).toBeHidden();
	await toggle.click();
	await expect(esc).toBeVisible();
});

test('chat bubbles replace the prefixed transcript when switched on', async ({ page }) => {
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');

	await page.goto('/settings');
	await page.getByRole('switch', { name: /Chat bubbles/ }).click();
	// The picker previews prove both colours reached the DOM.
	await expect(page.getByText(/Contrast .*passes AA/).first()).toBeVisible();

	await page.goto(href as string);
	const bubble = page.locator('main [style*="background"]').first();
	await expect(bubble).toBeVisible();

	await page.goto('/settings');
	await page.getByRole('switch', { name: /Chat bubbles/ }).click();
});

test('swipe to cycle can be turned off', async ({ page }) => {
	await page.goto('/settings');
	const toggle = page.getByRole('switch', { name: /Swipe to cycle agents/ });
	await expect(toggle).toHaveAttribute('aria-checked', 'true');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await page.reload();
	await expect(page.getByRole('switch', { name: /Swipe to cycle agents/ })).toHaveAttribute(
		'aria-checked',
		'false'
	);
	await page.getByRole('switch', { name: /Swipe to cycle agents/ }).click();
});

/**
 * Dispatched INSIDE the swipe root: the listener is on the page's root
 * element, and touch events bubble upward, so firing on `body` reaches
 * nothing. That mistake made an earlier version of this check silently pass.
 */
async function swipe(page: import('@playwright/test').Page, dx: number) {
	await page.evaluate((dx) => {
		const target = document.querySelector('main') as HTMLElement;
		const fire = (type: string, cx: number) => {
			const touch = new Touch({ identifier: 1, target, clientX: cx, clientY: 430 });
			target.dispatchEvent(
				new TouchEvent(type, {
					touches: type === 'touchend' ? [] : [touch],
					changedTouches: [touch],
					bubbles: true
				})
			);
		};
		fire('touchstart', 150);
		fire('touchend', 150 + dx);
	}, dx);
	await page.waitForTimeout(400);
	return decodeURIComponent(new URL(page.url()).pathname.replace('/a/', ''));
}

test('swiping cycles agents, and one back always returns to the list', async ({ page }) => {
	// Pin to a sort that live activity cannot reorder mid-test. Even so this
	// asserts a ROUND TRIP rather than fixed identities: panes really do come
	// and go against a live herdr, and an absolute comparison read at the start
	// of the test is stale by the end of it.
	await page.goto('/');
	await page.evaluate(() => {
		const raw = JSON.parse(localStorage.getItem('bordr-prefs') ?? '{}');
		localStorage.setItem(
			'bordr-prefs',
			JSON.stringify({ ...raw, v: 1, groupBy: 'none', sort: 'title' })
		);
	});
	await page.goto('/');
	const first = page.locator('main a[href^="/a/"]').first();
	// Rows arrive on the first SSE event: counting before that skipped the test.
	try {
		await first.waitFor({ state: 'attached', timeout: 10_000 });
	} catch {
		test.skip(true, 'no agents running');
	}
	const listed = await page
		.locator('main a[href^="/a/"]')
		.evaluateAll((ns) => ns.map((n) => (n.getAttribute('href') ?? '').replace('/a/', '')));
	if (listed.length < 3) test.skip(true, 'needs at least three agents');

	await first.click();
	// The page can only swipe once it knows its place in the order, and the
	// header's "n/m" counter is exactly that fact. Waiting a fixed delay
	// instead raced it and the swipe silently did nothing.
	await expect(page.locator('header')).toContainText(/\d+\/\d+/, { timeout: 10_000 });
	const start = decodeURIComponent(new URL(page.url()).pathname.replace('/a/', ''));

	// That a swipe MOVES is all this level can assert: blocked agents pin to the
	// front of the order, so any agent blocking mid-test reshuffles every index.
	// Which pane it lands on, and that left undoes right, are covered
	// deterministically by the flatOrder and neighbourPane unit tests.
	const moved = await swipe(page, 160);
	expect(moved, 'a right swipe should move to another agent').not.toBe(start);
	await expect(page.locator('header')).toContainText(/\d+\/\d+/, { timeout: 10_000 });

	// However many swipes, ONE back reaches the list — swipes replace history
	// rather than stacking it, which is the whole point of this test.
	for (let i = 0; i < 4; i++) await swipe(page, 160);
	await page.goBack();
	await page.waitForTimeout(500);
	expect(new URL(page.url()).pathname).toBe('/');
});
