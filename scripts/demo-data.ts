/**
 * Invented data for the README screenshots and demo GIF.
 *
 * Never point these scripts at a real herdr: the agents list shows workspace
 * names, working directories and transcript text, none of which belongs in a
 * public repository. Every string here is made up, so the images are
 * reproducible by anyone and leak nothing.
 */
import type { Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const AGENTS = [
	{
		paneId: 'w1:p1',
		agent: 'claude',
		title: 'checkout-flow',
		status: 'blocked',
		cwd: '/home/dev/code/storefront',
		seq: 42,
		workspaceId: 'w1',
		workspaceLabel: 'storefront',
		preview: 'Rename the coupon table or keep the old column?',
		picker: {
			question: 'Rename the coupon table, or keep the old column name?',
			context: [],
			numbered: true,
			multi: false,
			options: [
				{ index: 1, label: 'Rename it and write a migration', selected: true },
				{ index: 2, label: 'Keep the old name', selected: false },
				{ index: 3, label: 'Show me the schema first', selected: false }
			]
		}
	},
	{
		paneId: 'w1:p2',
		agent: 'codex',
		title: 'api-tests',
		status: 'working',
		cwd: '/home/dev/code/storefront',
		seq: 41,
		workspaceId: 'w1',
		workspaceLabel: 'storefront',
		preview: '▸ Bash bun run test:unit --filter cart',
		picker: null
	},
	{
		paneId: 'w2:p1',
		agent: 'pi',
		title: 'infra',
		status: 'done',
		cwd: '/home/dev/code/platform',
		seq: 38,
		workspaceId: 'w2',
		workspaceLabel: 'platform',
		preview: '✓ Terraform plan is clean, 0 to add, 0 to destroy.',
		picker: null
	},
	{
		paneId: 'w2:p2',
		agent: 'omp',
		title: 'docs',
		status: 'idle',
		cwd: '/home/dev/code/platform',
		seq: 30,
		workspaceId: 'w2',
		workspaceLabel: 'platform',
		preview: 'waiting for a prompt',
		picker: null
	},
	{
		paneId: 'w3:p1',
		agent: 'grok',
		title: 'scratch',
		status: 'idle',
		cwd: '/home/dev/code/sandbox',
		seq: 12,
		workspaceId: 'w3',
		workspaceLabel: 'sandbox',
		preview: 'waiting for a prompt',
		picker: null
	}
];

const COMPAT = { level: 'ok', message: null, version: '0.9.1', protocol: 22, session: 'main' };

const DETAIL = {
	...AGENTS[0],
	paneCwd: '/home/dev/code/storefront',
	branch: 'feature/coupon-codes',
	ahead: 1,
	behind: 0,
	branchUrl: 'https://github.com/example/storefront/tree/feature/coupon-codes',
	pull: {
		number: 48,
		state: 'OPEN',
		url: 'https://github.com/example/storefront/pull/48',
		checks: 'passing' as const,
		draft: false
	},
	model: 'claude-sonnet-4-6',
	degraded: 'none' as const,
	degradedReason: null,
	hasMore: false,
	activity: null,
	menu: null,
	suggestion: '',
	queue: [],
	subagents: [
		{
			id: 'agent-schema-audit',
			agentType: 'Explore',
			description: 'Inspect coupon & order discount schema references',
			toolUseId: 'toolu_01',
			spawnDepth: 1,
			entries: 14,
			lastAt: Date.now() - 12_000,
			done: true,
			parentAgentId: '',
			workflow: { runId: 'wf_checkout_01', name: 'schema-check' }
		}
	],
	screenTail: [
		'  Rename the coupon table, or keep the old column name?',
		'',
		'  \u276f 1. Rename it and write a migration',
		'    2. Keep the old name',
		'    3. Show me the schema first',
		'',
		'  Enter to select \u00b7 Esc to cancel'
	].join('\n'),
	statusLines: ['[model] | effort high | Context 24% | 📁 storefront'],
	statusAnsi: ['[model] | effort high | Context 24% | 📁 storefront'],
	statusRows: ['[model] | effort high | Context 24% | 📁 storefront'],
	messages: [
		{ role: 'user', text: 'Add a coupon code field to checkout.', tools: [] },
		{
			role: 'assistant',
			text: 'Added the field and wired it to the cart total. One question before I touch the schema.',
			tools: [
				{ name: 'Edit', summary: 'src/routes/checkout/+page.svelte' },
				{ name: 'Bash', summary: 'bun run check' }
			],
			blocks: [
				{
					kind: 'text',
					text: 'Added the field and wired it to the cart total:\n\n```ts\nconst total = $derived(\n\tlines.reduce((sum, l) => sum + l.price * l.qty, 0) - discount\n);\n```\n\nOne question before I touch the schema.'
				},
				{
					kind: 'tool',
					name: 'Edit',
					summary: 'src/routes/checkout/+page.svelte',
					input: { file_path: 'src/routes/checkout/+page.svelte' },
					result: null,
					diffs: []
				},
				{
					kind: 'tool',
					name: 'Bash',
					summary: 'bun run check',
					input: { command: 'bun run check' },
					result: { text: '0 errors, 0 warnings', isError: false, truncatedLines: 0 },
					diffs: []
				}
			]
		}
	]
};

/**
 * herdr's own shape, invented to match the agents above.
 *
 * The sidebar, the tab strip and the split all read `/api/panes`. Without a
 * stub they fall through to whatever herdr the screenshots are pointed at,
 * and the images then carry real workspace names, real branches and real
 * working directories. That is the one thing these scripts exist to prevent.
 */
const PANES = [
	{ paneId: 'w1:p1', agent: 'claude', status: 'blocked', title: 'checkout-flow' },
	{ paneId: 'w1:p2', agent: 'codex', status: 'idle', title: 'api-tests' }
];

const WORKSPACES = [
	{
		workspaceId: 'w1',
		machine: '',
		label: 'storefront',
		number: 1,
		focused: true,
		branch: 'feature/coupon-codes',
		worktree: {
			repoKey: '/home/dev/code/storefront',
			repoName: 'storefront',
			linked: false
		},
		tabs: [
			{
				tabId: 'w1:t1',
				workspaceId: 'w1',
				label: 'checkout',
				number: 1,
				focused: true,
				panes: PANES.map((p) => ({
					...p,
					tabId: 'w1:t1',
					workspaceId: 'w1',
					hasAgent: true,
					cwd: '/home/dev/code/storefront',
					focused: p.paneId === 'w1:p1'
				})),
				layout: {
					zoomed: false,
					focusedPaneId: 'w1:p1',
					tree: {
						kind: 'split',
						vertical: false,
						ratio: 0.55,
						path: [],
						first: { kind: 'pane', paneId: 'w1:p1' },
						second: { kind: 'pane', paneId: 'w1:p2' }
					}
				}
			}
		]
	},
	{
		workspaceId: 'w1b',
		machine: '',
		label: 'coupon-migration',
		number: 2,
		focused: false,
		branch: 'fix/coupon-column',
		worktree: {
			repoKey: '/home/dev/code/storefront',
			repoName: 'storefront',
			linked: true
		},
		tabs: [
			{
				tabId: 'w1b:t1',
				workspaceId: 'w1b',
				label: 'drizzle',
				number: 1,
				focused: true,
				panes: [
					{
						paneId: 'w1b:p1',
						tabId: 'w1b:t1',
						workspaceId: 'w1b',
						agent: 'claude',
						hasAgent: true,
						status: 'done',
						title: 'coupon-migration',
						cwd: '/home/dev/code/storefront-migration',
						focused: true
					}
				]
			}
		]
	},
	{
		workspaceId: 'w2',
		machine: '',
		label: 'platform',
		number: 3,
		focused: false,
		branch: 'main',
		tabs: [
			{
				tabId: 'w2:t1',
				workspaceId: 'w2',
				label: 'migrations',
				number: 1,
				focused: false,
				panes: [
					{
						paneId: 'w2:p1',
						tabId: 'w2:t1',
						workspaceId: 'w2',
						agent: 'pi',
						hasAgent: true,
						status: 'working',
						title: 'schema-migration',
						cwd: '/home/dev/code/platform',
						focused: false
					}
				]
			}
		]
	}
];

const MACHINES = [
	{
		machine: { id: 'this', label: 'this machine', target: '', session: 'default', enabled: true },
		state: 'connected',
		error: null
	},
	{
		machine: { id: 'tower', label: 'tower', target: 'tower', session: 'default', enabled: true },
		state: 'connected',
		error: null
	}
];

/** A pane as a harness actually draws it, for the terminal-mode shot. */
const SCREEN = [
	'\u256d\u2500 checkout-flow ' + '\u2500'.repeat(22) + '\u256e',
	'',
	'  \u25cf Read  src/routes/checkout/+page.svelte',
	'  \u25cf Edit  src/routes/checkout/+page.svelte',
	'      + const total = $derived(',
	'      +   lines.reduce((s, l) => s + l.price * l.qty, 0)',
	'      + );',
	'',
	'  \u25cf Bash  bun run check',
	'      0 errors, 0 warnings',
	'',
	'  The coupon column is called `code` in the schema but the',
	'  checkout form posts `coupon`. I can rename the column and',
	'  write a migration, or map it at the boundary.',
	'',
	'  Rename the coupon table, or keep the old column name?',
	'',
	'  \u276f 1. Rename it and write a migration',
	'    2. Keep the old name',
	'    3. Show me the schema first',
	'',
	'  Enter to select \u00b7 Esc to cancel',
	'',
	'\u2570' + '\u2500'.repeat(37) + '\u256f',
	'  [model] | effort high | Context 24% | \ud83d\udcc1 storefront'
].join('\n');

/** What the harness offers behind `/`, plus the operator's own skills. */
/** The same pane once the question has been answered. */
const SCREEN_AFTER = [
	'\u256d\u2500 checkout-flow ' + '\u2500'.repeat(22) + '\u256e',
	'',
	'  \u25cf Edit  drizzle/schema.ts',
	"      + export const coupons = pgTable('coupons', {",
	"      +   code: text('code').notNull()",
	'      + });',
	'',
	'  \u25cf Bash  bun run db:generate',
	'      1 migration written',
	'',
	'  Renaming it. Writing the migration now.',
	'',
	'\u2570' + '\u2500'.repeat(37) + '\u256f',
	'  [model] | effort high | Context 26% | \ud83d\udcc1 storefront'
].join('\n');

const COMMANDS = [
	{ name: 'model', description: 'Change the model for this session', source: 'harness' },
	{ name: 'effort', description: 'How hard it should think', source: 'harness' },
	{ name: 'usage', description: 'Tokens, cost and what is left', source: 'harness' },
	{ name: 'review', description: 'Review the diff on this branch', source: 'command' },
	{ name: 'deploy', description: 'Build, restart and smoke the service', source: 'skill' },
	{ name: 'handoff', description: 'Write the state of play for the next session', source: 'skill' }
];

/**
 * What the recording is in the middle of.
 *
 * A still wants the blocked state, which is why that is the default. The GIF
 * wants all three in order: the agent working, the question arriving, and the
 * answer having landed — because "a blocked agent, answered from the list" is
 * a claim about cause and effect, and a card that was already there when the
 * page loaded does not show it.
 */
export type Phase = 'working' | 'blocked' | 'answered';

/** The answer the demo taps, echoed back into the transcript afterwards. */
const ANSWER = 'Rename it and write a migration';

function agentsFor(phase: Phase) {
	return AGENTS.map((agent) => {
		if (agent.paneId !== 'w1:p1') return agent;
		if (phase === 'blocked') return agent;
		return {
			...agent,
			// JSON.stringify drops an undefined value, so this reaches the app as
			// no picker at all rather than as a stale one.
			picker: undefined,
			status: 'working',
			preview: phase === 'working' ? 'Reading the checkout schema…' : 'Writing the migration…'
		};
	});
}

function detailFor(phase: Phase) {
	const agent = agentsFor(phase).find((a) => a.paneId === 'w1:p1');
	// `picker: undefined` explicitly. Spreading an object that merely LACKS the
	// key leaves DETAIL's own picker in place, so the card that was waiting on
	// you stayed on screen after you had answered it — which is the one thing
	// this sequence exists to disprove.
	const base = { ...DETAIL, ...agent, picker: phase === 'blocked' ? DETAIL.picker : undefined };
	if (phase !== 'answered') return base;
	// The point of opening it: your answer is in the transcript, and the
	// question that was waiting on you is gone.
	return {
		...base,
		screenTail: SCREEN_AFTER,
		// `blocks` explicitly. The view renders blocks, and the backfill from
		// `text` happens on the SERVER in `adapterFor` — which a stubbed
		// response never reaches, so a message without them renders as nothing
		// at all while still counting towards "hide the work".
		messages: [
			...DETAIL.messages,
			{
				role: 'user',
				text: ANSWER,
				tools: [],
				blocks: [{ kind: 'text', text: ANSWER }]
			},
			{
				role: 'assistant',
				text: 'Renaming it, and writing the migration now.',
				tools: [{ name: 'Edit', summary: 'drizzle/schema.ts' }],
				blocks: [
					{ kind: 'text', text: 'Renaming it, and writing the migration now.' },
					{
						kind: 'tool',
						name: 'Edit',
						summary: 'drizzle/schema.ts',
						input: { file_path: 'drizzle/schema.ts' },
						result: { text: '1 migration written', isError: false, truncatedLines: 0 },
						diffs: []
					}
				]
			}
		]
	};
}

const sseFor = (phase: Phase) =>
	`event: agents\ndata: ${JSON.stringify(agentsFor(phase))}\n\n` +
	`event: read\ndata: ${JSON.stringify({ 'w1:p2': 41 })}\n\n` +
	`event: compat\ndata: ${JSON.stringify(COMPAT)}\n\n`;

const json = (body: unknown) => ({
	status: 200,
	contentType: 'application/json',
	body: JSON.stringify(body)
});

/**
 * Stub every route the app reads, and hand back a way to advance the story.
 *
 * The stubbed event stream is a finite body, so EventSource reconnects as soon
 * as it ends — continuously, for the life of the page. That is what makes a
 * phase change visible without any extra machinery: flip it here and the next
 * reconnect, about a second later, delivers it. The question genuinely arrives
 * on screen rather than having been there all along.
 */
export async function stub(page: Page, initial: Phase = 'blocked') {
	let phase: Phase = initial;

	await page.addInitScript(
		({ agents, compat }) => {
			class DemoEventSource extends EventTarget {
				static CONNECTING = 0;
				static OPEN = 1;
				static CLOSED = 2;
				readyState = 1;
				onopen: ((ev: Event) => unknown) | null = null;
				onmessage: ((ev: MessageEvent) => unknown) | null = null;
				onerror: ((ev: Event) => unknown) | null = null;
				constructor() {
					super();
					const push = (list: unknown) => {
						this.dispatchEvent(new MessageEvent('agents', { data: JSON.stringify(list) }));
						this.dispatchEvent(new MessageEvent('read', { data: JSON.stringify({ 'w1:p2': 41 }) }));
						this.dispatchEvent(new MessageEvent('compat', { data: JSON.stringify(compat) }));
					};
					window.addEventListener('demo-agents', (event) => push((event as CustomEvent).detail));
					setTimeout(() => {
						this.onopen?.(new Event('open'));
						this.dispatchEvent(new Event('open'));
						push(agents);
					}, 20);
				}
				close() {
					this.readyState = 2;
				}
			}
			Object.defineProperty(window, 'EventSource', { value: DemoEventSource });
		},
		{ agents: agentsFor(phase), compat: COMPAT }
	);

	// Regexes, not globs: the detail request carries a `?bytes=` query that a
	// `*` glob does not match, and the stub silently fell through to the real
	// server, which knows nothing about these invented panes.
	await page.route(/\/api\/events/, (route) =>
		route.fulfill({ status: 200, contentType: 'text/event-stream', body: sseFor(phase) })
	);
	await page.route(/\/api\/agents\/[^/]+\/watch/, (route) =>
		route.fulfill(json({ watched: false }))
	);
	await page.route(/\/api\/agents\/[^/?]+(\?|$)/, (route) => route.fulfill(json(detailFor(phase))));
	await page.route(/\/api\/agents(\?|$)/, (route) =>
		route.fulfill(json({ agents: agentsFor(phase), compat: COMPAT }))
	);
	// Everything the sidebar, tab strip and split read. Unstubbed, these reach
	// the real herdr and put its workspace names into the images.
	await page.route(/\/api\/panes/, (route) =>
		route.fulfill(json({ workspaces: WORKSPACES, machines: MACHINES }))
	);
	await page.route(/\/api\/layout/, (route) => route.fulfill(json({ ok: true })));
	await page.route(/\/api\/tabs/, (route) => route.fulfill(json({ ok: true })));
	await page.route(/\/api\/read-state/, (route) => route.fulfill(json({ 'w1:p2': 41 })));
	// Answering must succeed, or the recording shows "no picker on screen".
	//
	// And it must take a moment. Answering is a round trip to the host, which
	// is the whole reason the option you pressed marks itself while it is in
	// flight; an instant stub would leave that state on screen for no frames at
	// all and the recording would not show the thing it is demonstrating.
	await page.route(/\/api\/agents\/[^/]+\/(answer|prompt|keys|type)/, async (route) => {
		await new Promise((r) => setTimeout(r, 700));
		await route.fulfill(json({ ok: true, verified: true, outcome: 'accepted' }));
	});
	await page.route(/\/api\/agents\/[^/]+\/commands/, (route) =>
		route.fulfill(json({ agent: 'claude', commands: COMMANDS }))
	);
	await page.route(/\/api\/agents\/[^/]+\/read/, (route) =>
		route.fulfill(json({ text: SCREEN, lines: 24, atTop: true }))
	);

	return {
		/** Move the story on and broadcast it to the open DemoEventSource. */
		set(next: Phase) {
			phase = next;
			void page
				.evaluate(
					(list) => window.dispatchEvent(new CustomEvent('demo-agents', { detail: list })),
					agentsFor(phase)
				)
				.catch(() => {});
		}
	};
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.listen(0, '127.0.0.1', () => {
			const addr = srv.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			srv.close((err) => (err ? reject(err) : resolve(port)));
		});
		srv.on('error', reject);
	});
}

/**
 * Boot an isolated local bordr build with invented `BORDR_FILE_ROOTS` when no
 * URL was passed. Server-rendered routes like `/f` then list synthetic files
 * instead of the operator's disk, and capture works even when the live service
 * listens on a private Unix socket.
 */
export async function withDemoServer<T>(
	explicitUrl: string | undefined,
	run: (url: string) => Promise<T>
): Promise<T> {
	if (explicitUrl) return run(explicitUrl.replace(/\/$/, ''));
	const root = mkdtempSync(join(tmpdir(), 'bordr-demo-'));
	const docs = join(root, 'docs');
	const designs = join(root, 'designs');
	mkdirSync(docs, { recursive: true });
	mkdirSync(designs, { recursive: true });
	writeFileSync(join(docs, 'architecture.md'), '# Architecture\n\nSynthetic notes.\n');
	writeFileSync(join(docs, 'schema.sql'), 'CREATE TABLE coupons (code text primary key);\n');
	writeFileSync(join(docs, 'release-checklist.md'), '# Release Checklist\n');
	writeFileSync(join(designs, 'checkout-flow.svg'), '<svg viewBox="0 0 100 100"></svg>\n');
	writeFileSync(join(designs, 'receipt-preview.html'), '<!doctype html><p>Preview</p>\n');
	writeFileSync(join(root, 'endpoints.json'), '{"ssh":[]}');

	const port = await freePort();
	const url = `http://127.0.0.1:${port}`;
	const child = spawn('bun', ['--no-env-file', 'build/index.js'], {
		env: {
			...process.env,
			SOCKET_PATH: '',
			HOST: '127.0.0.1',
			PORT: String(port),
			HERDR_SOCKET: join(root, 'absent-herdr.sock'),
			HERDR_ENDPOINTS: join(root, 'endpoints.json'),
			BORDR_DATA_DIR: join(root, 'state'),
			BORDR_FILE_ROOTS: `docs:${docs},designs:${designs}`
		},
		stdio: 'ignore'
	});

	try {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			try {
				const res = await fetch(`${url}/settings`);
				if (res.ok) break;
			} catch {
				// still starting
			}
			await new Promise((r) => setTimeout(r, 100));
		}
		return await run(url);
	} finally {
		child.kill('SIGTERM');
		rmSync(root, { recursive: true, force: true });
	}
}
