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

async function fixture(
	page: Page,
	prefs: Record<string, unknown> = {},
	fleet: typeof agents = agents
) {
	const state = {
		details: 0,
		operations: [] as string[],
		agentData: fleet,
		treeData: workspaces,
		multi: false,
		typeCalls: [] as { pane: string; text: string }[],
		typeDelay: null as Promise<void> | null,
		typeStatus: 200,
		keyPanes: [] as string[],
		promptCalls: [] as string[],
		promptDelay: null as Promise<void> | null,
		command: null as { name: string; message: string } | null,
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
		answers: [] as { index: number; text?: string; dialog?: string }[],
		keyDelay: null as Promise<void> | null,
		answerDelay: null as Promise<void> | null,
		answerStatus: 200,
		missingPanes: new Set<string>(),
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
					window.addEventListener('fixture-agents', (event) =>
						this.dispatchEvent(
							new MessageEvent('agents', { data: JSON.stringify((event as CustomEvent).detail) })
						)
					);
					setTimeout(
						() => this.dispatchEvent(new MessageEvent('agents', { data: JSON.stringify(agents) })),
						50
					);
				}
				close() {}
			}
			Object.defineProperty(window, 'EventSource', { value: FixtureSource });
		},
		{ agents: fleet, prefs }
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
		if (path === '/api/agents') return respond({ agents: state.agentData });
		if (path === '/api/control') {
			state.controlCalls++;
			await state.controlDelay;
			return respond({ ok: true });
		}
		if (path.endsWith('/keys')) {
			state.operations.push('keys:start');
			state.keyPanes.push(path.split('/')[3]);
			state.keys.push(route.request().postDataJSON().keys);
			await state.keyDelay;
			state.operations.push('keys:end');
			state.selected = 2;
			return respond({ ok: true });
		}
		if (path.endsWith('/answer')) {
			state.operations.push('answer:start');
			state.answers.push(route.request().postDataJSON());
			await state.answerDelay;
			state.operations.push('answer:end');
			return respond({ outcome: 'accepted', message: 'fixture refusal' }, state.answerStatus);
		}
		if (path.endsWith('/type')) {
			state.operations.push('type:start');
			state.typeCalls.push({ pane: path.split('/')[3], text: route.request().postDataJSON().text });
			await state.typeDelay;
			state.operations.push('type:end');
			return respond({ message: 'fixture type refusal' }, state.typeStatus);
		}
		if (path.endsWith('/prompt') || path.endsWith('/image')) {
			state.promptCalls.push(path);
			await state.promptDelay;
			return respond({ ok: true, command: state.command });
		}
		if (path.endsWith('/watch')) return respond({ watched: false });
		if (path.endsWith('/read')) return respond({ text: 'fixture terminal\nline two' });
		if (/\/api\/agents\/[^/]+$/.test(path)) {
			state.details++;
			const paneId = path.split('/').at(-1)!;
			if (state.missingPanes.has(paneId)) return respond({ message: 'no pane' }, 404);
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
							multi: state.multi
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

for (const paneView of ['conversation', 'terminal']) {
	test(`${paneView}: selecting a pane focuses its input`, async ({ page }) => {
		const state = await fixture(page, { paneView, tabStrip: 'always' });
		state.picker = false;
		await openPane(page);
		await page.locator('a[href="/a/c"][role="tab"]').click();
		await expect.poll(() => new URL(page.url()).pathname).toBe('/a/c');
		const input =
			paneView === 'terminal'
				? page.getByRole('textbox', { name: 'Send to this pane' })
				: page.locator('textarea').first();
		await expect(input).toBeFocused();
	});
}

test('an exited current pane moves to a surviving sibling instead of the 404 page', async ({
	page
}) => {
	const state = await fixture(page);
	state.picker = false;
	await openPane(page);
	state.treeData = workspaces.map((workspace) => ({
		...workspace,
		tabs: workspace.tabs.map((tab) => ({
			...tab,
			panes: tab.panes.filter((pane) => pane.paneId !== 'a')
		}))
	}));
	state.missingPanes.add('a');
	await expect.poll(() => new URL(page.url()).pathname, { timeout: 6000 }).toBe('/a/c');
	await expect(page.getByText('agent not found')).toHaveCount(0);
});

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
	await page.getByRole('button', { name: 'Send', exact: true }).click();
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

test('terminal serializes empty Enter behind typing and cancels old-pane continuations', async ({
	page
}) => {
	const state = await fixture(page, { paneView: 'terminal' });
	state.picker = false;
	await openPane(page);
	const input = page.getByRole('textbox', { name: 'Send to this pane' });
	let release!: () => void;
	state.typeDelay = new Promise((r) => {
		release = r;
	});
	await input.fill('first terminal text');
	await input.press('Enter');
	await input.press('Enter');
	await expect.poll(() => state.typeCalls.length).toBe(1);
	await page.waitForTimeout(100);
	expect(state.keys).toEqual([]);
	release();
	await expect.poll(() => state.keys.length).toBe(2);
	expect(state.keyPanes).toEqual(['a', 'a']);
	state.typeDelay = new Promise((r) => {
		release = r;
	});
	await input.fill('old pane text');
	await input.press('Enter');
	await input.fill('queued old draft');
	await input.press('Tab');
	await expect.poll(() => state.typeCalls.length).toBe(2);
	await openPane(page, 'b');
	await input.fill('new pane text');
	release();
	await page.waitForTimeout(200);
	expect(state.typeCalls).toHaveLength(2);
	expect(state.keys).toHaveLength(2);
	await expect(input).toHaveValue('new pane text');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('bordr-draft:a')))
		.toContain('queued old draft');
});

test('terminal failed flush restores the original draft and never sends its key', async ({
	page
}) => {
	const state = await fixture(page, { paneView: 'terminal' });
	state.picker = false;
	await openPane(page);
	const input = page.getByRole('textbox', { name: 'Send to this pane' });
	let release!: () => void;
	state.typeDelay = new Promise((r) => {
		release = r;
	});
	state.typeStatus = 409;
	await input.fill('refused terminal');
	await input.press('Tab');
	await expect.poll(() => state.typeCalls.length).toBe(1);
	await openPane(page, 'b');
	await input.fill('new draft');
	release();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('bordr-draft:a')))
		.toContain('refused terminal');
	await expect(input).toHaveValue('new draft');
	expect(state.keys).toEqual([]);
});

test('terminal write-in focuses its input and submits the selected row via answer', async ({
	page
}) => {
	const state = await fixture(page, { paneView: 'terminal' });
	await openPane(page);
	await page.getByRole('button', { name: /Other/ }).click();
	const input = page.getByRole('textbox', { name: 'Send to this pane' });
	await expect(input).toBeFocused();
	await input.fill('terminal write-in');
	await input.press('Enter');
	await expect
		.poll(() => state.answers)
		.toEqual([{ index: 3, text: 'terminal write-in', dialog: expect.any(String) }]);
	expect(state.typeCalls).toEqual([]);
	expect(state.keys).toEqual([]);
});

test('successful type into a question preserves newer unsent composer text', async ({ page }) => {
	const state = await fixture(page);
	await openPane(page);
	const input = page.locator('textarea').first();
	let release!: () => void;
	state.typeDelay = new Promise((r) => {
		release = r;
	});
	await input.fill('sent into question');
	await input.press('Control+Enter');
	await expect.poll(() => state.typeCalls.length).toBe(1);
	await input.fill('NEWER UNSENT TEXT');
	release();
	await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
	await expect(input).toHaveValue('NEWER UNSENT TEXT');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('bordr-draft:a')))
		.toBe('NEWER UNSENT TEXT');
});

for (const kind of ['prompt', 'command', 'image', 'answer']) {
	test(`acknowledged off-screen ${kind} persists its outcome on the originating pane`, async ({
		page
	}) => {
		const state = await fixture(page);
		state.picker = kind === 'answer';
		if (kind === 'command') state.command = { name: 'reload', message: 'Fixture reload confirmed' };
		await openPane(page);
		let release!: () => void;
		const held = new Promise<void>((r) => {
			release = r;
		});
		if (kind === 'answer') {
			state.answerDelay = held;
			await page.getByRole('button', { name: /1 One/ }).click();
		} else {
			state.promptDelay = held;
			if (kind === 'image')
				await page.locator('input[type=file]').setInputFiles({
					name: 'fixture.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from('fixture')
				});
			await page
				.locator('textarea')
				.first()
				.fill(kind === 'command' ? '/reload' : 'off-screen fixture send');
			await page.locator('textarea').first().press('Control+Enter');
		}
		await expect
			.poll(() => (kind === 'answer' ? state.answers.length : state.promptCalls.length))
			.toBe(1);
		await openPane(page, 'b');
		release();
		const stored = () =>
			page.evaluate(() => JSON.parse(localStorage.getItem('bordr-pending:a') ?? '[]'));
		await expect
			.poll(async () => (await stored())[0]?.state)
			.toBe(kind === 'command' ? 'accepted' : 'queued');
		if (kind === 'command') expect((await stored())[0].receipt).toBe('Fixture reload confirmed');
		await openPane(page, 'a');
		expect((await stored())[0].state).not.toBe('unconfirmed');
	});
}

test('multi-select Submit uses the verified submit operation, not the checkbox toggle key', async ({
	page
}) => {
	const state = await fixture(page);
	state.multi = true;
	await openPane(page);
	await page.getByRole('button', { name: 'Submit selection', exact: true }).click();
	await expect.poll(() => state.answers).toEqual([{ submit: true }]);
	expect(state.keys).toEqual([]);
});

test('a stale conversation width cap cannot waste desktop space', async ({ page }) => {
	const state = await fixture(page, { conversationWidth: 'comfortable' });
	state.picker = false;
	state.treeData = [
		{
			...workspaces[0],
			tabs: [{ ...workspaces[0].tabs[0], panes: [workspaces[0].tabs[0].panes[0]] }]
		}
	];
	await openPane(page);
	const main = page.locator('.transcript-rows').locator('xpath=ancestor::main[1]');
	for (const viewport of [1400, 1600]) {
		await page.setViewportSize({ width: viewport, height: 900 });
		await expect
			.poll(async () => main.evaluate((el) => el.getBoundingClientRect().width))
			.toBeGreaterThan(0);
		const sizes = await main.evaluate((el) => ({
			main: el.getBoundingClientRect().width,
			available: el.parentElement!.getBoundingClientRect().width
		}));
		expect(Math.abs(sizes.main - sizes.available)).toBeLessThan(2);
	}
});

test('terminal failure cancels empty confirmations queued behind the failed text', async ({
	page
}) => {
	const state = await fixture(page, { paneView: 'terminal' });
	state.picker = false;
	await openPane(page);
	const input = page.getByRole('textbox', { name: 'Send to this pane' });
	let release!: () => void;
	state.typeDelay = new Promise((r) => {
		release = r;
	});
	state.typeStatus = 409;
	await input.fill('refused text');
	await input.press('Enter');
	await input.fill('second unsent');
	await input.press('Enter');
	await input.press('Enter');
	await expect.poll(() => state.typeCalls.length).toBe(1);
	release();
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('bordr-draft:a')))
		.toBe('refused text\nsecond unsent');
	await page.waitForTimeout(100);
	expect(state.keys).toEqual([]);
	state.typeDelay = null;
	state.typeStatus = 200;
	await input.fill('reviewed retry');
	await input.press('Enter');
	await expect.poll(() => state.keys.length).toBe(1);
});

test('Home does not hide a same-word approval for a new subject during the receipt hold', async ({
	page
}) => {
	const picker = {
		question: 'Proceed?',
		context: ['tool A'],
		multi: false,
		options: [
			{ index: 1, label: 'Yes', selected: true },
			{ index: 2, label: 'No', selected: false }
		]
	};
	const fleet = [{ ...agents[0], status: 'blocked', picker }];
	await fixture(page, {}, fleet);
	await move(page, '/');
	await page.getByRole('button', { name: '1. Yes', exact: true }).click();
	await expect(page.getByText('sent “Yes”', { exact: true })).toBeVisible();
	await page.evaluate(
		(agents) => window.dispatchEvent(new CustomEvent('fixture-agents', { detail: agents })),
		[{ ...fleet[0], seq: 2, picker: { ...picker, context: ['tool B'] } }]
	);
	await expect(page.getByRole('button', { name: '1. Yes', exact: true })).toBeVisible();
});

test.describe('filtered mobile navigation', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	test('swipes include shells but exclude idle agents outside the working list', async ({
		page
	}) => {
		const state = await fixture(
			page,
			{ listFilter: 'working' },
			agents.map((a) => ({ ...a, status: a.paneId === 'b' ? 'idle' : 'working' }))
		);
		state.picker = false;
		await openPane(page);
		await expect.poll(() => state.trees).toBeGreaterThan(0);
		const cdp = await page.context().newCDPSession(page);
		for (const pane of ['c', 'shell', 'a']) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchStart',
				touchPoints: [{ x: 90, y: 350 }]
			});
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x: 310, y: 350 }]
			});
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await expect.poll(() => new URL(page.url()).pathname).toBe(`/a/${pane}`);
			await page.waitForTimeout(350);
		}
	});
});

test('terminal write-in shares the full type/Tab queue and captures its row, dialog and text', async ({
	page
}) => {
	const state = await fixture(page, { paneView: 'terminal' });
	state.options.push({ index: 4, label: 'Another write-in', writeIn: true });
	await openPane(page);
	const input = page.getByRole('textbox', { name: 'Send to this pane' });
	let typed!: () => void;
	let keyed!: () => void;
	state.typeDelay = new Promise((r) => {
		typed = r;
	});
	state.keyDelay = new Promise((r) => {
		keyed = r;
	});
	await input.fill('earlier terminal text');
	await input.press('Tab');
	await expect.poll(() => state.typeCalls.length).toBe(1);
	await page.getByRole('button', { name: /3 Other/ }).click();
	await input.fill('captured write-in');
	await input.press('Enter');
	await page.waitForTimeout(100);
	expect(state.answers).toEqual([]);
	// A later selection/draft must not be read when the queued callback finally runs.
	await page.getByRole('button', { name: /4 Another write-in/ }).click();
	await input.fill('newer unsent draft');
	await input.press('Escape');
	const details = state.details;
	// An unchanged-dialog poll must not invalidate work queued on this same pane.
	await expect.poll(() => state.details).toBeGreaterThan(details);
	await page.waitForTimeout(100);
	expect(state.answers).toEqual([]);
	expect(state.keys).toEqual([]);
	typed();
	await expect.poll(() => state.keys).toEqual([['tab']]);
	expect(state.answers).toEqual([]);
	keyed();
	await expect
		.poll(() => state.answers)
		.toEqual([
			{ index: 3, text: 'captured write-in', dialog: expect.stringContaining('Choose a fixture') }
		]);
	await expect(input).toHaveValue('newer unsent draft');
	expect(state.operations).toEqual([
		'type:start',
		'type:end',
		'keys:start',
		'keys:end',
		'answer:start',
		'answer:end'
	]);
	// Even if polling has not seen the answer replace the dialog, queued old keys are cancelled.
	await page.waitForTimeout(100);
	expect(state.keys).toEqual([['tab']]);
});

for (const replacement of ['pane', 'dialog', 'failed type']) {
	test(`terminal queued write-in cancels on ${replacement} and restores original text`, async ({
		page
	}) => {
		const state = await fixture(page, { paneView: 'terminal' });
		await openPane(page);
		const input = page.getByRole('textbox', { name: 'Send to this pane' });
		let release!: () => void;
		state.typeDelay = new Promise((r) => {
			release = r;
		});
		if (replacement === 'failed type') state.typeStatus = 409;
		await input.fill('earlier text');
		await input.press('Tab');
		await expect.poll(() => state.typeCalls.length).toBe(1);
		await page.getByRole('button', { name: /3 Other/ }).click();
		await input.fill('captured pending answer');
		await input.press('Enter');
		if (replacement === 'pane') {
			await openPane(page, 'b');
			await input.fill('B draft');
		} else if (replacement === 'dialog') {
			state.question = 'Replacement dialog';
			await expect(page.getByText('Replacement dialog', { exact: true })).toBeVisible({
				timeout: 10000
			});
		}
		release();
		await expect
			.poll(() => page.evaluate(() => localStorage.getItem('bordr-draft:a')))
			.toContain('captured pending answer');
		expect(state.answers).toEqual([]);
		expect(state.keys).toEqual([]);
		if (replacement === 'pane') await expect(input).toHaveValue('B draft');
		if (replacement === 'failed type')
			await expect
				.poll(() => page.evaluate(() => localStorage.getItem('bordr-draft:a')))
				.toBe('earlier text\ncaptured pending answer');
	});
}

test('refused queued terminal write-in retains its row and draft for an explicit retry', async ({
	page
}) => {
	const state = await fixture(page, { paneView: 'terminal' });
	await openPane(page);
	const input = page.getByRole('textbox', { name: 'Send to this pane' });
	await page.getByRole('button', { name: /3 Other/ }).click();
	state.answerStatus = 409;
	await input.fill('retry this write-in');
	await input.press('Enter');
	await expect.poll(() => state.answers.length).toBe(1);
	await expect(input).toHaveValue('retry this write-in');
	await expect(page.getByRole('button', { name: /3 Other/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	state.answerStatus = 200;
	await input.press('Enter');
	await expect.poll(() => state.answers.length).toBe(2);
	expect(state.answers.map(({ index, text }) => ({ index, text }))).toEqual([
		{ index: 3, text: 'retry this write-in' },
		{ index: 3, text: 'retry this write-in' }
	]);
	expect(state.typeCalls).toEqual([]);
	expect(state.keys).toEqual([]);
});
