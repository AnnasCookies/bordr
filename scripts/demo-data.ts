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
			]
		}
	]
};

const sse =
	`event: agents\ndata: ${JSON.stringify(AGENTS)}\n\n` +
	`event: read\ndata: ${JSON.stringify({ 'w1:p2': 41 })}\n\n` +
	`event: compat\ndata: ${JSON.stringify(COMPAT)}\n\n`;

const json = (body: unknown) => ({
	status: 200,
	contentType: 'application/json',
	body: JSON.stringify(body)
});

export async function stub(page: Page) {
	// Regexes, not globs: the detail request carries a `?bytes=` query that a
	// `*` glob does not match, and the stub silently fell through to the real
	// server, which knows nothing about these invented panes.
	await page.route(/\/api\/events/, (route) =>
		route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse })
	);
	await page.route(/\/api\/agents\/[^/]+\/watch/, (route) =>
		route.fulfill(json({ watched: false }))
	);
	await page.route(/\/api\/agents\/[^/?]+(\?|$)/, (route) => route.fulfill(json(DETAIL)));
	await page.route(/\/api\/agents(\?|$)/, (route) =>
		route.fulfill(json({ agents: AGENTS, compat: COMPAT }))
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
}
