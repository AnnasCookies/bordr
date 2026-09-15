import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({ page }) => {
	page.on('pageerror', (error) => {
		throw error;
	});
});
const stamp = Date.now();
const agents = ['a', 'b', 'c'].map((paneId) => ({
	paneId,
	agent: 'pi',
	title: `Fixture ${paneId}`,
	status: 'working',
	cwd: '/fixture',
	seq: 1,
	workspaceId: 'w',
	workspaceLabel: 'Fixture',
	tabId: paneId === 'b' ? 't2' : 't1',
	tabLabel: 'Fixture'
}));
const workspaces = [
	{
		workspaceId: 'w',
		label: 'Fixture',
		machineId: '',
		machineLabel: '',
		tabs: [
			{
				tabId: 't1',
				workspaceId: 'w',
				number: 1,
				label: 'Split',
				panes: ['a', 'c', 'shell'].map((paneId) => ({
					...agents[0],
					paneId,
					hasAgent: paneId !== 'shell',
					tabId: 't1'
				}))
			},
			{
				tabId: 't2',
				workspaceId: 'w',
				number: 2,
				label: 'Other',
				panes: [{ ...agents[1], hasAgent: true }]
			}
		]
	}
];

async function fixture(page: Page, prefs: Record<string, unknown> = {}) {
	const state = {
		treeData: workspaces,
		controlDelay: null as Promise<void> | null,
		controlCalls: 0,
		extraBlocks: [] as unknown[],
		trees: 0,
		selected: 1,
		options: [
			{ index: 1, label: 'One' },
			{ index: 2, label: 'Two' },
			{ index: 3, label: 'Other', writeIn: true }
		],
		picker: true,
		question: 'Choose a fixture',
		keys: [] as string[][],
		answers: [] as { index: number; text?: string }[],
		keyDelay: null as Promise<void> | null,
		answerDelay: null as Promise<void> | null,
		answerStatus: 200,
		children: [
			{
				id: 'agent-finished',
				agentType: 'Finished fixture',
				description: 'done',
				entries: 3,
				done: true,
				lastAt: stamp,
				toolUseId: 't',
				parentAgentId: '',
				spawnDepth: 1
			}
		]
	};
	await page.addInitScript(
		({ agents, prefs }) => {
			localStorage.setItem(
				'bordr-prefs',
				JSON.stringify({
					v: 2,
					conversationWidth: 'comfortable',
					subagentStrip: 'all',
					splitLayout: false,
					tabStrip: 'off',
					bubbles: true,
					...prefs
				})
			);
			class FixtureSource extends EventTarget {
				static OPEN = 1;
				static CLOSED = 2;
				readyState = 1;
				onerror = null;
				constructor() {
					super();
					setTimeout(
						() => this.dispatchEvent(new MessageEvent('agents', { data: JSON.stringify(agents) })),
						50
					);
				}
				close() {}
			}
			Object.defineProperty(window, 'EventSource', { value: FixtureSource });
		},
		{ agents, prefs }
	);
	await page.route('**/api/**', async (route) => {
		const url = new URL(route.request().url());
		const path = decodeURIComponent(url.pathname);
		const respond = (body: unknown, status = 200) =>
			route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		if (path === '/api/panes') {
			state.trees++;
			return respond({ workspaces: state.treeData });
		}
		if (path === '/api/agents') return respond({ agents });
		if (path === '/api/control') {
			state.controlCalls++;
			await state.controlDelay;
			return respond({ ok: true });
		}
		if (path.endsWith('/keys')) {
			state.keys.push(route.request().postDataJSON().keys);
			await state.keyDelay;
			state.selected = 2;
			return respond({ ok: true });
		}
		if (path.endsWith('/answer')) {
			state.answers.push(route.request().postDataJSON());
			await state.answerDelay;
			return respond({ outcome: 'accepted', message: 'fixture refusal' }, state.answerStatus);
		}
		if (path.endsWith('/watch')) return respond({ watched: false });
		if (path.endsWith('/read')) return respond({ text: 'fixture terminal\nline two' });
		if (/\/api\/agents\/[^/]+$/.test(path)) {
			const paneId = path.split('/').at(-1)!;
			return respond({
				...(agents.find((a) => a.paneId === paneId) ?? agents[0]),
				paneId,
				paneCwd: '/fixture',
				branch: '',
				ahead: 0,
				behind: 0,
				branchUrl: '',
				pull: null,
				model: 'fixture-model',
				messages: [
					{
						role: 'assistant',
						at: stamp,
						text: 'Fixture transcript',
						tools: [],
						blocks: [
							{ kind: 'text', text: 'Fixture transcript' },
							...state.extraBlocks,
							{
								kind: 'tool',
								name: 'bash',
								summary: 'inspect fixture',
								input: { command: 'echo fixture' },
								result: { text: 'fixture output', isError: false, truncatedLines: 0 },
								diffs: []
							}
						]
					}
				],
				subagents: state.children,
				queue: [],
				screenTail: 'fixture terminal',
				statusLines: [],
				statusAnsi: [],
				statusRows: [],
				degraded: 'none',
				degradedReason: null,
				hasMore: false,
				activity: null,
				menu: null,
				suggestion: '',
				picker: state.picker
					? {
							question: state.question,
							context: [],
							numbered: true,
							options: state.options.map((o) => ({ ...o, selected: o.index === state.selected })),
							multi: false
						}
					: null
			});
		}
		return respond({});
	});
	await page.goto('/settings');
	await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
	return state;
}

async function move(page: Page, path: string) {
	await page.evaluate((path) => {
		const a = document.createElement('a');
		a.href = path;
		a.textContent = 'fixture navigation';
		a.id = 'fixture-link';
		document.body.append(a);
	}, path);
	await page.locator('#fixture-link').click();
	await page.locator('#fixture-link').evaluate((el) => el.remove());
	await expect.poll(() => new URL(page.url()).pathname).toBe(path);
}
async function openPane(page: Page, pane = 'a') {
	await move(page, `/a/${pane}`);
	await expect(page.getByRole('button', { name: 'Pane and tab controls' })).toBeVisible();
}
async function focusPage(page: Page) {
	await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

test('queued arrows precede fresh Enter selection; native summaries and resizers own their keys', async ({
	page
}) => {
	const state = await fixture(page);
	await openPane(page);
	await focusPage(page);
	let release!: () => void;
	state.keyDelay = new Promise((resolve) => (release = resolve));
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => state.keys.length).toBe(1);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(150);
	expect(state.answers).toEqual([]);
	release();
	await expect.poll(() => state.answers).toEqual([{ index: 2 }]);
	// A new dialog resets the held answer card.
	state.question = 'Next fixture';
	await move(page, '/a/b');
	const summary = page.locator('summary').first();
	await summary.focus();
	await page.keyboard.press('Enter');
	const handle = page.getByRole('button', { name: /Resize the sidebar/ });
	await handle.focus();
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(150);
	expect(state.answers).toHaveLength(1);
	expect(state.keys).toHaveLength(1);
});

test('queued confirmations never cross pane navigation', async ({ page }) => {
	const state = await fixture(page);
	await openPane(page);
	await focusPage(page);
	let release!: () => void;
	state.keyDelay = new Promise((resolve) => (release = resolve));
	await page.keyboard.press('ArrowDown');
	await expect.poll(() => state.keys.length).toBe(1);
	await page.keyboard.press('Enter');
	await openPane(page, 'b');
	release();
	await page.waitForTimeout(250);
	expect(state.answers).toEqual([]);
});

test('write-ins beginning with digits remain text and refused sends merge newer drafts', async ({
	page
}) => {
	const state = await fixture(page);
	await openPane(page);
	await focusPage(page);
	await page.keyboard.press('3');
	const composer = page.locator('textarea').first();
	await expect(composer).toBeFocused();
	await page.keyboard.type('2 starts this answer');
	expect(state.answers).toEqual([]);
	let release!: () => void;
	state.answerDelay = new Promise((resolve) => (release = resolve));
	state.answerStatus = 409;
	await page.keyboard.press('Control+Enter');
	await expect.poll(() => state.answers.length).toBe(1);
	await composer.fill('newer draft');
	release();
	await expect(composer).toHaveValue(/2 starts this answer/);
	await expect(composer).toHaveValue(/newer draft/);
});

test('restored interrupted sends stay recoverable; Off retains all children in the bounded archive', async ({
	page
}) => {
	const state = await fixture(page, { subagentStrip: 'off' });
	state.picker = false;
	state.children.push(
		...Array.from({ length: 80 }, (_, i) => ({
			...state.children[0],
			id: `agent-${i}`,
			agentType: `Child ${i}`
		}))
	);
	await page.evaluate(() =>
		localStorage.setItem(
			'bordr-pending:a',
			JSON.stringify([{ id: 1, text: 'uncertain fixture send', at: Date.now(), state: 'sending' }])
		)
	);
	await openPane(page);
	await expect(page.getByRole('button', { name: 'Finished fixture done 3' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Pane and tab controls' }).click();
	await expect(page.getByText('Finished fixture', { exact: true })).toBeVisible();
	const dialog = page.getByRole('dialog', { name: /controls/ });
	expect(await dialog.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
	expect(await dialog.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
	await page.getByText('Child 79', { exact: true }).scrollIntoViewIfNeeded();
	await expect(page.getByText('Child 79', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(page.getByText(/Delivery unconfirmed/)).toBeVisible();
	await page.getByRole('button', { name: 'Restore draft', exact: true }).click();
	await expect(page.locator('textarea').first()).toHaveValue('uncertain fixture send');
});

test('All includes finished-only children and desktop Files/Search menus have visible drawers', async ({
	page
}) => {
	const state = await fixture(page);
	state.picker = false;
	await openPane(page);
	await expect(page.getByText('Finished fixture', { exact: true })).toBeVisible();
	for (const path of ['/f', '/search']) {
		await move(page, path);
		await page
			.getByRole('button', { name: /Session list|Workspaces/, exact: true })
			.first()
			.click();
		await expect(page.getByRole('button', { name: 'Close the session list' })).toBeVisible();
		await page.getByRole('button', { name: 'Close the session list' }).click();
	}
});

test.describe('mobile', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	for (const paneView of ['conversation', 'terminal']) {
		test(`${paneView}: hidden strips retain the full ring including shells`, async ({ page }) => {
			const state = await fixture(page, { paneView, tabStrip: 'off' });
			state.picker = false;
			await openPane(page);
			await expect.poll(() => state.trees).toBeGreaterThan(0);
			await page.evaluate(() => new Promise(requestAnimationFrame));
			const cdp = await page.context().newCDPSession(page);
			for (const pane of ['c', 'shell', 'b', 'a']) {
				await cdp.send('Input.dispatchTouchEvent', {
					type: 'touchStart',
					touchPoints: [{ x: 90, y: 350 }]
				});
				await cdp.send('Input.dispatchTouchEvent', {
					type: 'touchMove',
					touchPoints: [{ x: 310, y: 352 }]
				});
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
				await expect.poll(() => new URL(page.url()).pathname).toBe(`/a/${pane}`);
				await expect(page.getByRole('button', { name: 'Pane and tab controls' })).toBeVisible();
			}
		});
	}
	test('touch drawer corner closes instead of navigating Home', async ({ page }) => {
		const state = await fixture(page);
		state.picker = false;
		await openPane(page);
		const menu = page.getByRole('button', { name: 'Session list', exact: true });
		const box = (await menu.boundingBox())!;
		await menu.tap();
		const x = box.x + box.width / 2,
			y = box.y + box.height / 2;
		expect(
			await page.evaluate(
				([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'),
				[x, y]
			)
		).toBe('Close the session list');
		await page.touchscreen.tap(x, y);
		await expect(page.getByRole('button', { name: 'Close the session list' })).toBeHidden();
		expect(new URL(page.url()).pathname).toBe('/a/a');
	});
});

test('duplicate todo prose renders and numbered long diffs keep gutters aligned', async ({
	page
}) => {
	const state = await fixture(page);
	state.picker = false;
	const long = 'x'.repeat(300);
	state.extraBlocks = [
		{
			kind: 'tool',
			name: 'todo',
			summary: 'fixture plan',
			input: {},
			result: null,
			diffs: [],
			todo: {
				completed: 0,
				abandoned: 0,
				closed: 0,
				total: 4,
				open: 4,
				blocked: 0,
				activePhase: 'Repeated phase',
				activePhaseIndex: 1,
				phaseCount: 2,
				phases: [1, 2].map(() => ({
					name: 'Repeated phase',
					items: [1, 2].map(() => ({ content: 'Repeated task', status: 'pending' }))
				}))
			}
		},
		{
			kind: 'tool',
			name: 'edit',
			summary: '/fixture.ts',
			input: {},
			result: { text: 'edited', isError: false, truncatedLines: 0 },
			diffs: [
				{
					file: '/fixture.ts',
					before: Array.from({ length: 80 }, (_, i) => `${i} ${long}`).join('\n'),
					after: Array.from({ length: 80 }, (_, i) => `${i} changed ${long}`).join('\n'),
					beforeLines: Array.from({ length: 80 }, (_, i) => 5 + i * 2),
					afterLines: Array.from({ length: 80 }, (_, i) => 5 + i * 2)
				}
			]
		}
	];
	await openPane(page);
	const plan = page.locator('summary').filter({ hasText: 'plan' }).first();
	await plan.click();
	await expect(page.getByText('Repeated task', { exact: true })).toHaveCount(4);
	const edit = page.locator('summary').filter({ hasText: 'fixture.ts' }).first();
	await edit.click();
	const numbered = page.locator('.numbered').first();
	await expect(numbered).toBeVisible();
	expect(await numbered.evaluate((el) => getComputedStyle(el).flexShrink)).toBe('0');
	const tails = page.locator('.transcript-rows > * svg[viewBox="0 0 14 18"]');
	expect(await tails.count()).toBeGreaterThan(0);
	for (let i = 0; i < (await tails.count()); i++) {
		expect(
			await tails.nth(i).evaluate((el) => {
				const row = el.closest('.transcript-rows > *')!.getBoundingClientRect();
				const tail = el.getBoundingClientRect();
				return tail.left >= row.left - 1 && tail.right <= row.right + 1;
			})
		).toBe(true);
	}
});

test('a write-in failure after navigation restores the originating pane only', async ({ page }) => {
	const state = await fixture(page);
	await openPane(page);
	await focusPage(page);
	await page.keyboard.press('3');
	const composer = page.locator('textarea').first();
	await composer.fill('original answer');
	let release!: () => void;
	state.answerDelay = new Promise((resolve) => (release = resolve));
	state.answerStatus = 409;
	await page.keyboard.press('Control+Enter');
	await expect.poll(() => state.answers.length).toBe(1);
	await openPane(page, 'b');
	await composer.fill('other pane draft');
	release();
	await expect(composer).toHaveValue('other pane draft');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('bordr-draft:a')))
		.toContain('original answer');
	await openPane(page, 'a');
	await expect(composer).toHaveValue('original answer');
});

test('closing a hidden split tab captures membership before asynchronous tree changes', async ({
	page
}) => {
	const state = await fixture(page);
	state.picker = false;
	await openPane(page, 'c');
	await expect.poll(() => state.trees).toBeGreaterThan(0);
	await page.getByRole('button', { name: 'Pane and tab controls' }).click();
	await page.getByRole('button', { name: 'tab', exact: true }).click();
	let release!: () => void;
	state.controlDelay = new Promise((resolve) => (release = resolve));
	await page
		.getByRole('button', { name: 'Close this tab ends what is running', exact: true })
		.click();
	await page.getByRole('button', { name: 'Close it', exact: true }).click();
	await expect.poll(() => state.controlCalls).toBe(1);
	const reads = state.trees;
	state.treeData = [];
	await expect.poll(() => state.trees, { timeout: 8000 }).toBeGreaterThan(reads);
	await page.evaluate(() => new Promise(requestAnimationFrame));
	release();
	await expect.poll(() => new URL(page.url()).pathname).toBe('/a/b');
});
