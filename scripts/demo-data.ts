/**
 * Invented data for the README screenshots and demo GIF.
 *
 * Never point these scripts at a real herdr: the agents list shows workspace
 * names, working directories and transcript text, none of which belongs in a
 * public repository. Every string here is made up, so the images are
 * reproducible by anyone and leak nothing.
 */
import type { Page } from '@playwright/test';

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

const COMPAT = { level: 'ok', message: null, version: '0.9.0', protocol: 20, session: 'main' };

const DETAIL = {
	...AGENTS[0],
	degraded: 'none',
	hasMore: false,
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
					diff: null
				},
				{
					kind: 'tool',
					name: 'Bash',
					summary: 'bun run check',
					input: { command: 'bun run check' },
					result: { text: '0 errors, 0 warnings', isError: false },
					diff: null
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
		workspaceId: 'w2',
		machine: '',
		label: 'platform',
		number: 2,
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
						result: { text: '1 migration written', isError: false },
						diff: null
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
	// Answering must succeed, or the recording shows "no picker on screen".
	await page.route(/\/api\/agents\/[^/]+\/(answer|prompt|keys|type)/, (route) =>
		route.fulfill(json({ ok: true, verified: true }))
	);
	await page.route(/\/api\/agents\/[^/]+\/commands/, (route) =>
		route.fulfill(json({ agent: 'claude', commands: COMMANDS }))
	);
	await page.route(/\/api\/agents\/[^/]+\/read/, (route) =>
		route.fulfill(json({ text: SCREEN, lines: 24, atTop: true }))
	);

	// The stubbed stream is a finite body, so EventSource reconnects the moment
	// it ends and the header shows its reconnect spinner. That is an artefact of
	// the stub, not of the app, so keep it out of the picture.
	//
	// addInitScript, not addStyleTag: a style tag belongs to the document that
	// was open when it was added and is lost on the next navigation, which is
	// why the spinner came back in the recording.
	await page.addInitScript(() => {
		const hide = () => {
			const style = document.createElement('style');
			style.textContent = '[aria-label="Reconnecting"]{display:none!important}';
			document.head.append(style);
		};
		if (document.head) hide();
		else document.addEventListener('DOMContentLoaded', hide);
	});

	return {
		/** Move the story on. The next reconnect carries it to the screen. */
		set(next: Phase) {
			phase = next;
		}
	};
}
