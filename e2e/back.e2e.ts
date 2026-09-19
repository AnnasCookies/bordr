import { expect, test } from '@playwright/test';
import { refuseViewportLeases } from './leases';

// Opening a pane at phone width would otherwise resize a real herdr tab.
test.beforeEach(({ page }) => refuseViewportLeases(page));

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

	const x = box!.x + box!.width / 2;
	const y = box!.y + box!.height / 2;
	// See the touch variant below for why the element is asked for directly.
	const under = await page.evaluate(
		([px, py]) =>
			document.elementFromPoint(px, py)?.closest('a, button')?.getAttribute('aria-label') ?? null,
		[x, y] as const
	);
	expect(under, 'the drawer control under the header menu').toBe('Close the session list');

	const url = page.url();
	await page.mouse.click(x, y);

	await expect(page.getByRole('link', { name: 'Home — all agents' })).toBeHidden();
	await page.waitForTimeout(600);
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

test.describe('on a touch screen', () => {
	/**
	 * Touch is what draws the back arrow. Without it the arrow is hidden, the
	 * header's ☰ sits where the drawer's does by default, and the corner test
	 * above passes whatever the drawer draws — which is how #30 moved the
	 * header's ☰ onto the drawer's Home link and nothing failed.
	 */
	test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

	test('tapping where the menu button is closes the drawer, with the back arrow drawn', async ({
		page
	}) => {
		const href = await firstPane(page);
		test.skip(!href, 'no agents running');
		await page.goto(href as string);
		await expect(page.getByRole('link', { name: 'Back to agents' })).toBeVisible();

		const menu = page.getByRole('button', { name: 'Session list', exact: true });
		const box = (await menu.boundingBox())!;
		await menu.tap();
		const close = page.getByRole('button', { name: 'Close the session list' });
		await expect(close).toBeVisible();

		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		// Asked directly, because the tap alone cannot tell: the drawer's Home
		// link closes the drawer before it navigates, so "closed" held either
		// way, and the URL was read before the navigation landed.
		const under = await page.evaluate(
			([px, py]) =>
				document.elementFromPoint(px, py)?.closest('a, button')?.getAttribute('aria-label') ?? null,
			[x, y] as const
		);
		expect(under, 'the drawer control under the header menu').toBe('Close the session list');

		const url = page.url();
		await page.touchscreen.tap(x, y);
		await expect(close).toBeHidden();
		// Long enough for a client-side navigation to land, had the tap started one.
		await page.waitForTimeout(600);
		expect(page.url(), 'that corner must not navigate').toBe(url);
	});

	/**
	 * The divider used to leave its move handler bound to the window when the
	 * browser cancelled the gesture, so every later scroll resized the section.
	 *
	 * Real touches through the DevTools protocol, not synthetic PointerEvents:
	 * `setPointerCapture` throws for a pointer that is not really down, so a
	 * dispatched pointerdown never started a drag and the old version of this
	 * test could not fail. So the drag has to be seen to follow first.
	 */
	test('the sidebar divider follows a drag and lets go when the browser cancels it', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Workspaces', exact: true }).tap();

		const handle = page.getByRole('button', { name: /Resize the machines section/ });
		await expect(handle).toBeVisible();
		// Without this the browser scrolls instead of letting us drag.
		expect(await handle.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');

		// The resizable machines section itself, not the drawer's button row.
		const section = page
			.locator('nav[aria-label="Session"]:visible > div[style*="height"]')
			.first();
		const height = async () => (await section.boundingBox())!.height;
		const start = await height();
		const grip = (await handle.boundingBox())!;
		const x = grip.x + grip.width / 2;
		const y = grip.y + grip.height / 2;

		const cdp = await page.context().newCDPSession(page);
		const touch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
			points: Array<{ x: number; y: number }> = []
		) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });

		await touch('touchStart', [{ x, y }]);
		await touch('touchMove', [{ x, y: y + 80 }]);
		await expect
			.poll(height, { message: 'the drag has to follow first' })
			.toBeGreaterThan(start + 40);
		await touch('touchCancel');
		const dragged = await height();

		// A later gesture somewhere else must leave it alone.
		await touch('touchStart', [{ x, y: y + 200 }]);
		await touch('touchMove', [{ x, y: y + 320 }]);
		await touch('touchEnd');
		await page.waitForTimeout(150);
		expect(
			Math.abs((await height()) - dragged),
			'a cancelled drag must stop listening'
		).toBeLessThan(2);
	});
});

/**
 * Pane links on the conversation page replace the history entry, so back goes
 * to the list however many panes you went through. The old version clicked
 * the first four `/a/` links, which were mostly the pane already open — a
 * link that pushed history still passed.
 */
test('back returns to the agents list however much you moved around', async ({ page }) => {
	await page.goto('/');
	await page.locator('main a[href^="/a/"]').first().waitFor({ state: 'attached' });
	const hrefs = await page.evaluate(() => [
		...new Set(
			[...document.querySelectorAll('main a[href^="/a/"]')].map((a) => a.getAttribute('href') ?? '')
		)
	]);
	test.skip(hrefs.length < 3, 'needs three agents to move between');

	await page.locator(`main a[href="${hrefs[0]}"]`).first().click();
	await expect.poll(() => new URL(page.url()).pathname).toBe(hrefs[0]);
	const replace = await page
		.locator('[data-sveltekit-replacestate]')
		.first()
		.getAttribute('data-sveltekit-replacestate');
	expect(replace, 'pane links must replace history by default').not.toBe('false');

	let moved = 0;
	for (const next of hrefs.slice(1, 4)) {
		const close = page.getByRole('button', { name: 'Close the session list' });
		if (!(await close.isVisible())) {
			await page.getByRole('button', { name: 'Session list', exact: true }).click();
		}
		const link = page
			.locator('nav[aria-label="Session"]:visible')
			.locator(`a[href="${next}"]`)
			.first();
		if ((await link.count()) === 0) continue;
		await link.click();
		await expect.poll(() => new URL(page.url()).pathname).toBe(next);
		moved += 1;
	}
	test.skip(moved < 2, 'the drawer listed too few of those panes to move between');

	await page.goBack();
	await expect(page).toHaveURL(/\/$|\/\?/);
});

/**
 * The same rule off the conversation page. Files pushed a history entry per
 * folder: measured on 2026-09-15, four folders deep took five backs.
 */
test('back returns to the agents list from deep in Files', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('link', { name: 'Files' }).first().click();
	await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/f/);

	let depth = 0;
	for (let i = 0; i < 3; i++) {
		const here = new URL(page.url()).pathname;
		const folder = page.locator(`main a[href^="${here === '/f' ? '/f/' : `${here}/`}"]`).first();
		if ((await folder.count()) === 0) break;
		await folder.click();
		await expect.poll(() => new URL(page.url()).pathname).not.toBe(here);
		depth += 1;
	}
	test.skip(depth < 2, 'no file roots with folders to walk into');

	await page.goBack();
	await expect(page).toHaveURL(/\/$|\/\?/);
});

/** Going back to the list by a link must not leave a second copy of it underneath. */
test('a link back to the agents list steps back rather than stacking another', async ({ page }) => {
	await page.goto('/');
	const before = await page.evaluate(() => history.length);
	await page.getByRole('link', { name: 'Settings' }).first().click();
	await expect(page).toHaveURL(/\/settings/);
	await page.getByRole('link', { name: 'Agents' }).first().click();
	await expect(page).toHaveURL(/\/$|\/\?/);
	// history.length never shrinks; a step back leaves it where the push put it.
	expect(await page.evaluate(() => history.length)).toBe(before + 1);
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

test("the sidebar toggles to Herdr's grouped workspace, tab and pane order", async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Workspaces', exact: true }).click();

	const order = page.getByRole('button', { name: /Agent order:/ });
	await expect(order).toHaveAccessibleName('Agent order: priority. Switch to grouped');
	await order.click();
	await expect(order).toHaveAccessibleName('Agent order: grouped. Switch to priority');

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

	await order.click();
	await expect(order).toHaveAccessibleName('Agent order: priority. Switch to grouped');
});

test('the desktop sidebar resizes live and persists only when released', async ({ page }) => {
	await page.setViewportSize({ width: 1400, height: 900 });
	await page.goto('/');

	const handle = page.getByRole('button', { name: /Resize the sidebar/ });
	await expect(handle).toBeVisible();
	const panel = handle.locator('..');
	const before = (await panel.boundingBox())!;
	const grab = (await handle.boundingBox())!;

	await page.evaluate(() => {
		const state = window as typeof window & { __prefWrites: number };
		state.__prefWrites = 0;
		const original = localStorage.setItem.bind(localStorage);
		localStorage.setItem = (key, value) => {
			state.__prefWrites += 1;
			original(key, value);
		};
	});

	await page.mouse.move(grab.x + grab.width / 2, grab.y + 100);
	await page.mouse.down();
	await page.mouse.move(grab.x + grab.width / 2 + 80, grab.y + 100, { steps: 20 });
	await page.evaluate(() => new Promise(requestAnimationFrame));

	const during = (await panel.boundingBox())!;
	expect(during.width).toBeGreaterThan(before.width + 70);
	expect(
		await page.evaluate(() => (window as typeof window & { __prefWrites: number }).__prefWrites)
	).toBe(0);

	await page.mouse.up();
	expect(
		await page.evaluate(() => (window as typeof window & { __prefWrites: number }).__prefWrites)
	).toBe(1);
	const stored = await page.evaluate(
		() =>
			(JSON.parse(localStorage.getItem('bordr-prefs') ?? '{}') as { sidebarWidth: number })
				.sidebarWidth
	);
	expect(stored).toBe(Math.round(during.width));
});
