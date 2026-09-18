import { expect, test } from '@playwright/test';
import { openSettings } from './settings';

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

/** Pick an actual transcript, not a live shell pane with no chat bubbles. */
async function firstTranscriptPane(page: import('@playwright/test').Page): Promise<string | null> {
	if (!(await firstPane(page))) return null;
	const hrefs = await page
		.locator('main a[href^="/a/"]')
		.evaluateAll((links) => [
			...new Set(
				links.map((link) => link.getAttribute('href')).filter((href): href is string => !!href)
			)
		]);
	for (const href of hrefs) {
		await page.goto(href);
		if ((await page.locator('main [style*="background"]').count()) > 0) return href;
	}
	return null;
}

test('the key strip offers exactly the eight allowed keys, including enter', async ({ page }) => {
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);
	await page.getByRole('button', { name: 'Manual controls' }).click();

	for (const key of ['esc', 'tab', 'up', 'down', 'left', 'right', 'space', 'enter']) {
		await expect(page.getByRole('button', { name: key, exact: true })).toBeVisible();
	}
});

test('conversation controls expose common toggles at desktop widths', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem('bordr-prefs', JSON.stringify({ showThinking: true }));
	});
	await page.setViewportSize({ width: 1400, height: 900 });
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);

	const thinkingHeader = page.getByRole('button', { name: 'Hide thinking', exact: true });
	await expect(thinkingHeader).toBeVisible();
	await expect(thinkingHeader).toHaveText(`thinking ${await page.locator('.thinking').count()}`);
	await page.getByRole('button', { name: 'Pane and tab controls' }).click();
	const thinking = page
		.getByRole('dialog', { name: /controls/ })
		.getByRole('button', { name: /Show thinking/ });
	await expect(thinking).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByRole('button', { name: /Show tools/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /Notify when this agent finishes/ })).toBeVisible();

	await thinking.click();
	await expect(thinking).toHaveAttribute('aria-pressed', 'false');
	expect(
		await page.evaluate(
			() =>
				(JSON.parse(localStorage.getItem('bordr-prefs') ?? '{}') as { showThinking?: boolean })
					.showThinking
		)
	).toBe(false);
});

test('an expanded tool stays open when the transcript refreshes', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			'bordr-prefs',
			JSON.stringify({ splitPanes: false, showWork: true, groupTools: false })
		);
	});
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	const panePath = new URL(href as string, 'http://bordr.test').pathname;
	let refreshes = 0;
	page.on('response', (response) => {
		const url = new URL(response.url());
		if (
			decodeURIComponent(url.pathname) === `/api/agents/${decodeURIComponent(panePath.slice(3))}` &&
			url.searchParams.has('bytes')
		) {
			refreshes++;
		}
	});
	await page.goto(href as string);
	// Use the newest visible call; the oldest can legitimately leave the 80-message window.
	const tool = page.locator('details.tool').last();
	if ((await tool.count()) === 0) test.skip(true, 'no tool call in the visible transcript');
	await tool.locator('summary').click();
	await expect(tool).toHaveJSProperty('open', true);
	const before = refreshes;
	await expect.poll(() => refreshes).toBeGreaterThan(before);
	await expect(tool).toHaveJSProperty('open', true);
});

test('desktop conversation uses all space beside the sidebar while resizing', async ({ page }) => {
	await page.addInitScript(() => {
		// An old saved cap must not keep winning after the choice was removed.
		localStorage.setItem('bordr-prefs', JSON.stringify({ conversationWidth: 'comfortable' }));
	});
	await page.setViewportSize({ width: 1400, height: 900 });
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);

	const row = page.locator('.transcript-rows > *').last();
	await expect(row).toBeAttached();
	// The history sentinel intersects during first layout before scrollBottom lands.
	// That is not a request for older transcript data and must not widen every poll.
	await page.waitForTimeout(750);
	expect(new URL(page.url()).searchParams.has('w')).toBe(false);
	await expect
		.poll(() => row.evaluate((element) => getComputedStyle(element).contentVisibility))
		.toBe('auto');

	const main = page.locator('.transcript-rows').locator('xpath=ancestor::main[1]');
	const widths = await main.evaluate((element) => ({
		main: element.getBoundingClientRect().width,
		available: element.parentElement?.getBoundingClientRect().width ?? 0
	}));
	expect(Math.abs(widths.main - widths.available)).toBeLessThan(2);
});

test('desktop split owns the terminal grid and writes canonical dividers', async ({ page }) => {
	let geometryWrites = 0;
	let geometryClaimStatus = 0;
	let geometryReleases = 0;
	let layoutWrites = 0;
	let previewReads = 0;
	const terminalReads: URL[] = [];
	page.on('request', (request) => {
		const requestUrl = new URL(request.url());
		const pathname = requestUrl.pathname;
		if (pathname === '/api/geometry' && request.method() === 'POST') {
			geometryWrites++;
			if ((request.postDataJSON() as { action?: string }).action === 'release') geometryReleases++;
		}
		if (pathname === '/api/layout' && request.method() === 'POST') layoutWrites++;
		if (pathname.endsWith('/read') && request.method() === 'GET') {
			previewReads++;
			terminalReads.push(requestUrl);
		}
	});
	page.on('response', (response) => {
		if (new URL(response.url()).pathname !== '/api/geometry') return;
		if ((response.request().postDataJSON() as { action?: string }).action === 'claim') {
			geometryClaimStatus = response.status();
		}
	});
	await page.setViewportSize({ width: 1400, height: 900 });
	await page.goto('/');
	const pane = await page.evaluate(async () => {
		const data = (await (await fetch('/api/panes')).json()) as {
			workspaces?: Array<{
				tabs: Array<{ panes: Array<{ paneId: string; agent?: string }> }>;
			}>;
		};
		const tab = data.workspaces
			?.flatMap((workspace) => workspace.tabs)
			.find((candidate) => candidate.panes.length > 1);
		return (
			tab?.panes.find((candidate) => candidate.agent && candidate.agent !== 'unknown')?.paneId ?? ''
		);
	});
	if (!pane) test.skip(true, 'no split tab with an agent pane running');
	await page.goto(`/a/${encodeURIComponent(pane)}`);

	const preview = page.getByRole('button', { name: 'Open this pane' }).first();
	await expect(preview).toBeVisible();
	// The focused agent keeps its conversation; every sibling is a full live terminal.
	await expect(page.locator('.transcript-rows')).toBeAttached();
	await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
	await expect(preview.locator('.term')).toBeVisible();
	await expect
		.poll(() => terminalReads.filter((url) => url.searchParams.get('source') === 'visible').length)
		.toBeGreaterThanOrEqual(1);
	const liveReads = terminalReads.filter((url) => url.searchParams.get('source') === 'visible');
	expect(liveReads.every((url) => url.searchParams.get('lines') === '20000')).toBe(true);
	await expect.poll(() => geometryWrites).toBeGreaterThan(0);
	await expect.poll(() => geometryClaimStatus).not.toBe(0);
	if (geometryClaimStatus === 409) test.skip(true, 'another browser holds the viewport lease');
	expect(geometryClaimStatus).toBe(200);
	await expect
		.poll(() => preview.evaluate((element) => element.parentElement?.dataset.autoFit ?? ''))
		.toBe('');
	const sizing = await preview.evaluate((element) => {
		const branch = element.parentElement!;
		const split = branch.parentElement!;
		const pre = element.querySelector('pre');
		const branchBox = branch.getBoundingClientRect();
		const splitBox = split.getBoundingClientRect();
		return {
			style: branch.getAttribute('style') ?? '',
			auto: branch.dataset.autoFit,
			branchWidth: branchBox.width,
			branchHeight: branchBox.height,
			splitWidth: splitBox.width,
			splitHeight: splitBox.height,
			whiteSpace: pre ? getComputedStyle(pre).whiteSpace : '',
			overflowWrap: pre ? getComputedStyle(pre).overflowWrap : '',
			opacity: getComputedStyle(element).opacity,
			terminalColumns: Number(branch.dataset.terminalColumns ?? 0)
		};
	});
	expect(sizing.auto).toBeUndefined();
	expect(sizing.style).toContain('flex:');
	expect(sizing.style).not.toContain('max-width');
	expect(sizing.style).not.toContain('max-height');
	// Focused and sibling panes now share the same fixed-grid terminal surface.
	expect(sizing.whiteSpace).toBe('pre');
	expect(sizing.overflowWrap).toBe('normal');
	expect(sizing.opacity).toBe('1');

	await preview.evaluate((element) => {
		const pre = element.querySelector('pre');
		(window as typeof window & { __previewBlanked?: boolean }).__previewBlanked = false;
		if (!pre) return;
		new MutationObserver(() => {
			if (!pre.textContent) {
				(window as typeof window & { __previewBlanked?: boolean }).__previewBlanked = true;
			}
		}).observe(pre, { childList: true, subtree: true, characterData: true });
	});
	// /api/panes refreshes every five seconds. It used to remount the preview,
	// leaving an empty <pre> for one frame before the same screen came back.
	await page.waitForTimeout(5_500);
	expect(
		await page.evaluate(
			() => (window as typeof window & { __previewBlanked?: boolean }).__previewBlanked
		)
	).toBe(false);
	const settled = await preview.evaluate((element) => {
		const box = element.parentElement!.getBoundingClientRect();
		return { width: box.width, height: box.height };
	});
	expect(Math.abs(settled.width - sizing.branchWidth)).toBeLessThan(1);
	expect(Math.abs(settled.height - sizing.branchHeight)).toBeLessThan(1);
	expect(previewReads).toBeGreaterThanOrEqual(4);

	const divider = page.getByRole('button', { name: /Resize this split/ }).first();
	const before = await divider.getAttribute('aria-label');
	await divider.focus();
	// One key matches a side-by-side divider, the other a stacked one.
	await divider.press('ArrowLeft');
	await divider.press('ArrowUp');
	await expect(divider).not.toHaveAttribute('aria-label', before ?? '');
	await expect.poll(() => layoutWrites).toBeGreaterThan(0);

	await page.getByRole('link', { name: 'Back to agents', exact: true }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect.poll(() => geometryReleases).toBeGreaterThan(0);
});

test('mobile leases a phone-sized grid without following the software keyboard', async ({
	page
}) => {
	type GeometryWrite = {
		action: 'claim' | 'update' | 'release';
		cols?: number;
		rows?: number;
		leaseId?: string;
	};
	const writes: GeometryWrite[] = [];
	await page.route('**/api/geometry', async (route) => {
		const body = route.request().postDataJSON() as GeometryWrite;
		writes.push(body);
		if (body.action === 'release') {
			await route.fulfill({ json: { type: 'tab_viewport_released', released: true } });
			return;
		}
		await route.fulfill({
			json: {
				type: 'tab_viewport_lease',
				lease_id: 'mobile-test-lease',
				cols: body.cols,
				rows: body.rows,
				ttl_ms: 15_000
			}
		});
	});

	await page.setViewportSize({ width: 390, height: 844 });
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);
	await expect
		.poll(() => writes.find((write) => write.action === 'claim')?.cols ?? 0)
		.toBeGreaterThan(0);
	const portrait = writes.find((write) => write.action === 'claim')!;
	expect(portrait.rows).toBeGreaterThan(10);

	const updatesBeforeKeyboard = writes.filter((write) => write.action === 'update').length;
	await page.setViewportSize({ width: 390, height: 500 });
	await page.waitForTimeout(600);
	expect(writes.filter((write) => write.action === 'update')).toHaveLength(updatesBeforeKeyboard);

	await page.setViewportSize({ width: 844, height: 390 });
	await expect
		.poll(() => writes.filter((write) => write.action === 'update').length)
		.toBeGreaterThan(updatesBeforeKeyboard);
	const landscape = writes.filter((write) => write.action === 'update').at(-1)!;
	expect(landscape.cols).not.toBe(portrait.cols);

	await page.getByRole('link', { name: 'Back to agents', exact: true }).click();
	await expect.poll(() => writes.some((write) => write.action === 'release')).toBe(true);
});

test('desktop picker questions take arrow and number keys from an empty composer', async ({
	page
}) => {
	await page.setViewportSize({ width: 1400, height: 900 });
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	const pane = decodeURIComponent((href as string).replace('/a/', ''));
	const detailPath = `/api/agents/${encodeURIComponent(pane)}`;
	const keys: string[][] = [];
	const answers: number[] = [];

	await page.route(
		(url) => url.pathname === detailPath,
		async (route) => {
			const response = await route.fetch();
			const detail = await response.json();
			await route.fulfill({
				response,
				json: {
					...detail,
					status: 'blocked',
					picker: {
						question: 'Pick a test option:',
						context: [],
						options: [
							{ index: 1, label: 'One', selected: true },
							{ index: 2, label: 'Two', selected: false }
						],
						multi: false,
						numbered: true
					}
				}
			});
		}
	);
	await page.route(`**/api/agents/${encodeURIComponent(pane)}/keys`, async (route) => {
		keys.push(((await route.request().postDataJSON()) as { keys: string[] }).keys);
		await route.fulfill({ json: { ok: true } });
	});
	await page.route(`**/api/agents/${encodeURIComponent(pane)}/answer`, async (route) => {
		const index = ((await route.request().postDataJSON()) as { index: number }).index;
		answers.push(index);
		await route.fulfill({
			json: {
				ok: true,
				chose: index === 1 ? 'One' : 'Two',
				// Keep the mocked picker open after Enter so this one test can also
				// prove arrow and number handling against the same dialog.
				outcome: index === 1 ? 'unknown' : 'accepted'
			}
		});
	});

	await page.locator(`main a[href="${href}"]`).first().click();
	await expect(page.getByText('Pick a test option:', { exact: true })).toBeVisible();

	const composer = page.getByRole('textbox', { name: 'Message' });
	// A real Claude picker appears while focus is still in this box. Empty means
	// the picker owns its terminal shortcuts; typed text means the draft owns them.
	await composer.fill('draft');
	await composer.press('2');
	expect(await composer.inputValue()).toBe('draft2');
	expect(answers).toEqual([]);
	await composer.fill('');

	await composer.press('Enter');
	await expect.poll(() => answers).toEqual([1]);
	expect(await composer.inputValue()).toBe('');
	await composer.press('ArrowDown');
	await expect.poll(() => keys).toEqual([['down']]);
	expect(await composer.inputValue()).toBe('');
	await composer.press('2');
	await expect.poll(() => answers).toEqual([1, 2]);
	// The shortcut schedules the normal refresh burst; do not let a mocked
	// detail fetch outlive the test that owns its route.
	await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('Enter in the composer makes a newline instead of sending', async ({ page }) => {
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);

	const box = page.locator('main ~ * textarea, textarea').first();
	await box.fill('first line');
	await box.press('Enter');
	await box.type('second line');
	expect(await box.inputValue()).toBe('first line\nsecond line');
});

test('Tab completes the highlighted slash command', async ({ page }) => {
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);

	const box = page.getByRole('textbox', { name: 'Message' });
	await box.fill('/mo');
	const option = page.locator('[role="option"][aria-selected="true"]');
	try {
		await option.waitFor({ state: 'visible', timeout: 10_000 });
	} catch {
		test.skip(true, 'active harness has no matching slash command');
	}
	const command = ((await option.locator('span').first().textContent()) ?? '').trim();
	await box.press('Tab');
	expect(await box.inputValue()).toBe(`${command} `);
	await expect(page.getByRole('listbox', { name: 'Slash commands' })).toBeHidden();
});

test('a successful slash command leaves a visible receipt', async ({ page }) => {
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);

	const pane = decodeURIComponent((href as string).replace('/a/', ''));
	await page.route(`**/api/agents/${encodeURIComponent(pane)}/prompt`, (route) =>
		route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({
				ok: true,
				command: { name: 'reload', outcome: 'confirmed', message: '✓ Pi reloaded' }
			})
		})
	);

	await page.getByRole('textbox', { name: 'Message' }).fill('/reload');
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(page.getByText('✓ Pi reloaded', { exact: true })).toBeVisible();
});

test('route refresh waits for a pause in typing', async ({ page }) => {
	const href = await firstPane(page);
	if (!href) test.skip(true, 'no agents running');
	await page.goto(href as string);

	const pane = decodeURIComponent((href as string).replace('/a/', ''));
	const detailPath = `/api/agents/${encodeURIComponent(pane)}`;
	let detailRequests = 0;
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === detailPath) detailRequests += 1;
	});

	const box = page.getByRole('textbox', { name: 'Message' });
	await box.fill('c');
	detailRequests = 0;
	await page.keyboard.type('ontinuous typing keeps expensive transcript refreshes off this path', {
		delay: 45
	});
	expect(detailRequests).toBe(0);

	await expect.poll(() => detailRequests, { timeout: 3_000 }).toBeGreaterThan(0);
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
	await expect(esc).toBeHidden();
	await toggle.click();
	await expect(esc).toBeVisible();
	await toggle.click();
	await expect(esc).toBeHidden();
});

test('chat bubbles replace the prefixed transcript when switched on', async ({ page }) => {
	const href = await firstTranscriptPane(page);
	if (!href) test.skip(true, 'no agents running');

	await openSettings(page, 'chat bubbles');
	await page.getByRole('switch', { name: /Chat bubbles/ }).click();

	await page.goto(href as string);
	const bubble = page.locator('main [style*="background"]').first();
	await expect(bubble).toBeVisible();

	await openSettings(page, 'chat bubbles');
	await page.getByRole('switch', { name: /Chat bubbles/ }).click();
});

test('swipe to cycle can be turned off', async ({ page }) => {
	await openSettings(page, 'input');
	const toggle = page.getByRole('switch', { name: /Swipe to cycle agents/ });
	await expect(toggle).toHaveAttribute('aria-checked', 'true');
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await openSettings(page, 'input');
	await expect(page.getByRole('switch', { name: /Swipe to cycle agents/ })).toHaveAttribute(
		'aria-checked',
		'false'
	);
	await page.getByRole('switch', { name: /Swipe to cycle agents/ }).click();

	const inverted = page.getByRole('switch', { name: /Invert swipe direction/ });
	await expect(inverted).toHaveAttribute('aria-checked', 'false');
	await inverted.click();
	await expect(inverted).toHaveAttribute('aria-checked', 'true');
	await openSettings(page, 'input');
	await expect(page.getByRole('switch', { name: /Invert swipe direction/ })).toHaveAttribute(
		'aria-checked',
		'true'
	);
});

/**
 * Dispatched on the header, which sits inside the shared swipe root in both
 * conversation and terminal views. `main` only exists in conversation view,
 * so targeting it broke as soon as a live swipe reached a shell pane.
 */
async function swipe(page: import('@playwright/test').Page, dx: number) {
	const before = new URL(page.url()).pathname;
	await page.locator('[data-viewport-header]').evaluate((target, dx) => {
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
	// Wait for the navigation a swipe causes, not for a guess at how long it
	// takes. 400ms was enough on an idle machine and not under the test
	// runner, which made this the flakiest test in the suite — it failed
	// consistently while the same gesture, driven identically against the same
	// build outside the harness, navigated every time.
	//
	// Swallowed on purpose: a swipe that genuinely goes nowhere must return the
	// pane it started on so the assertion can say so, rather than blowing up
	// here with a timeout that hides which case it was.
	await page.waitForURL((url) => url.pathname !== before, { timeout: 5_000 }).catch(() => {});
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

	// However many swipes, ONE back reaches the list — swipes replace history
	// rather than stacking it, which is the whole point of this test.
	for (let i = 0; i < 4; i++) await swipe(page, 160);
	await page.goBack();
	await page.waitForTimeout(500);
	expect(new URL(page.url()).pathname).toBe('/');
});
