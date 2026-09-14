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
	const home = page.getByRole('link', { name: 'Home — all agents' });
	await expect(home).toBeVisible();
	await expect(close).toBeVisible();

	// 44px is the tap target this app holds itself to.
	const box = await close.boundingBox();
	expect(box!.height).toBeGreaterThanOrEqual(44);
	expect(box!.width).toBeGreaterThanOrEqual(44);

	await close.click();
	await expect(home).toBeHidden();
});

/**
 * The drawer covers the header, so whatever is drawn in the top-left corner is
 * what a thumb hits when it returns to the control it just used. It landing on
 * a link home instead of a close button is the bug this guards.
 */
test('tapping where the menu button is closes the drawer rather than navigating', async ({
	page
}) => {
	const href = await firstPane(page);
	test.skip(!href, 'no agents running');
	await page.goto(href as string);

	const menu = page.getByRole('button', { name: 'Session list', exact: true });
	const box = await menu.boundingBox();
	await menu.click();
	await expect(page.getByRole('link', { name: 'Home — all agents' })).toBeVisible();

	const url = page.url();
	await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

	await expect(page.getByRole('link', { name: 'Home — all agents' })).toBeHidden();
	expect(page.url(), 'that corner must not navigate').toBe(url);
});

test('the page underneath does not scroll while the drawer is open', async ({ page }) => {
	const href = await firstPane(page);
	test.skip(!href, 'no agents running');
	await page.goto(href as string);

	const locked = () => page.evaluate(() => document.body.style.overflow);
	expect(await locked()).not.toBe('hidden');

	await page.getByRole('button', { name: 'Session list', exact: true }).click();
	expect(await locked(), 'body should be held still under the drawer').toBe('hidden');

	await page.getByRole('button', { name: 'Close the session list' }).click();
	expect(await locked(), 'and released again afterwards').not.toBe('hidden');
});

/**
 * The drawer is the same component on both screens, so the control that opens
 * and closes it has to look and behave the same on both. Home is the only
 * difference, and only because offering it on the agents list is pointless.
 */
test('the agents list drawer has the same toggle, and no Home of its own', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Workspaces', exact: true }).click();

	const close = page.getByRole('button', { name: 'Close the session list' });
	await expect(close).toBeVisible();
	await expect(close).toHaveText('☰');
	await expect(page.getByRole('link', { name: 'Home — all agents' })).toHaveCount(0);

	await close.click();
	await expect(close).toBeHidden();
});

test("the sidebar keeps Herdr's workspace, tab and pane order", async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Workspaces', exact: true }).click();

	const expected = await page.evaluate(async () => {
		const response = await fetch('/api/panes');
		const body = await response.json();
		return body.workspaces.flatMap(
			(workspace: { tabs: Array<{ panes: Array<{ paneId: string; hasAgent: boolean }> }> }) =>
				workspace.tabs.flatMap((tab) =>
					tab.panes.filter((pane) => pane.hasAgent).map((pane) => pane.paneId)
				)
		);
	});
	const links = page.locator('[data-agent-list] a[href^="/a/"]');
	await expect(links).toHaveCount(expected.length, { timeout: 10_000 });
	const actual = await links.evaluateAll((rows) =>
		rows.map((row) => decodeURIComponent((row.getAttribute('href') ?? '').replace('/a/', '')))
	);

	expect(actual).toEqual(expected);
});

/**
 * The divider used to leave its move handler bound to the window when the
 * browser cancelled the gesture, so every later scroll resized the sidebar.
 * Both halves are guarded: the gesture must be ours to begin with, and a
 * cancelled drag must not keep listening.
 */
test('the sidebar divider claims the gesture and lets go when cancelled', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Workspaces', exact: true }).click();

	const handle = page.getByRole('button', { name: /Resize the machines section/ });
	await expect(handle).toBeVisible();

	// Without this the browser scrolls instead of letting us drag.
	expect(await handle.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');

	const section = page.locator('nav[aria-label="Session"] > div').first();
	const before = (await section.boundingBox())!.height;

	// A drag the browser takes over for a scroll: down, then cancel.
	await handle.evaluate((el) => {
		const opts = { bubbles: true, pointerId: 1, pointerType: 'touch', clientY: 300 };
		el.dispatchEvent(new PointerEvent('pointerdown', opts));
		el.dispatchEvent(new PointerEvent('pointercancel', opts));
	});
	// Anything moving afterwards must not resize it.
	await handle.evaluate((el) => {
		el.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				pointerId: 1,
				pointerType: 'touch',
				clientY: 700
			})
		);
	});
	await page.waitForTimeout(150);

	const after = (await section.boundingBox())!.height;
	expect(Math.abs(after - before), 'a cancelled drag must stop listening').toBeLessThan(2);
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

/**
 * The tab bar is `sticky bottom-0`, which only holds it down while there is
 * something to scroll. Every class on the row above it was `lg:`-prefixed, so
 * below the breakpoint that row took only the height of its contents and the
 * bar sat wherever the content stopped — 226px up an 844px screen on Settings
 * once its groups collapsed and the page got shorter than the phone.
 */
for (const path of ['/', '/settings', '/settings/connection', '/search']) {
	test(`the tab bar sits on the bottom of the screen on ${path}`, async ({ page }) => {
		await page.goto(path);
		const bar = page.getByRole('navigation').filter({ hasText: 'Settings' }).first();
		await expect(bar).toBeVisible();
		const gap = await bar.evaluate(
			(el) => window.innerHeight - Math.round(el.getBoundingClientRect().bottom)
		);
		expect(gap, `tab bar floats ${gap}px above the bottom on ${path}`).toBeLessThanOrEqual(1);
	});
}

/**
 * Connection drew its own back arrow before the bar had one. Two arrows side
 * by side, pointing at different places, and the one that looked like the back
 * button was the wrong one.
 */
test('a screen has one back arrow, and it goes one level up', async ({ page }) => {
	await page.goto('/settings/connection');
	const backs = page.locator('header a').filter({ hasText: '←' });
	await expect(backs).toHaveCount(1);
	await expect(backs.first()).toHaveAttribute('href', '/settings');

	await page.goto('/settings');
	const fromSettings = page.locator('header a').filter({ hasText: '←' });
	await expect(fromSettings).toHaveCount(1);
	await expect(fromSettings.first()).toHaveAttribute('href', '/');
});
