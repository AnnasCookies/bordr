import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import { error, json } from '@sveltejs/kit';
import {
	getClient,
	HerdrRequestError,
	sendText,
	rawAgent,
	readVisible,
	sendKeys,
	settleScreen,
	waitForActiveAgent
} from '$lib/server/herdr';
import { encodeOmpStartupPrompt } from '$lib/server/omp-startup-prompt';
import { waitForWorkspacePane } from '$lib/server/herdr/workspace-pane';
import { herdrAgentName, uniqueHerdrAgentName } from '$lib/server/herdr/agent-name';
import { piAdapter } from '$lib/server/transcript/pi';
import { readTranscriptTail } from '$lib/server/transcript/tail';
import type { RequestHandler } from './$types';

const KINDS = new Set([
	'claude',
	'codex',
	'pi',
	'omp',
	'grok',
	'agy',
	'gemini',
	'cursor',
	'copilot',
	'opencode'
]);

const HOME = homedir();
const OMP_STARTUP_EXTENSION = resolve(process.cwd(), 'src/lib/server/omp-startup-prompt.ts');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The sheet says "confined to ~" and SECURITY.md promises it; until now only
 * the directory LISTING enforced it, so a typed path went straight through.
 * Same rule as /api/dirs: real path, after symlinks, under the real home.
 */
function confinedCwd(cwd: string | undefined): string | null {
	const typed = cwd?.trim();
	if (!typed) return null;
	const expanded = typed.replace(/^~(?=\/|$)/, HOME);
	let real: string;
	let realHome: string;
	try {
		real = realpathSync(resolve(expanded));
		realHome = realpathSync(HOME);
	} catch {
		throw error(400, `no such directory: ${typed}`);
	}
	if (real !== realHome && !real.startsWith(realHome + sep)) {
		throw error(400, 'cwd must be inside your home directory');
	}
	return real;
}

/** Create a fresh workspace and start a harness in it. */
export const POST: RequestHandler = async ({ request }) => {
	const { kind, cwd, label, prompt } = (await request.json()) as {
		kind?: string;
		cwd?: string;
		label?: string;
		prompt?: string;
	};
	if (!kind || !KINDS.has(kind)) throw error(400, `kind must be one of: ${[...KINDS].join(', ')}`);
	const directory = confinedCwd(cwd);
	const initialPrompt = typeof prompt === 'string' && prompt.trim() ? prompt : undefined;
	if (kind === 'omp' && !initialPrompt) {
		throw error(400, 'OMP needs a first message to start its session');
	}

	const herdr = getClient();
	let paneId: string | undefined;
	try {
		const created = await herdr.request<{ workspace?: { workspace_id?: string } }>(
			'workspace.create',
			{
				cwd: directory,
				label: label?.trim() || kind,
				focus: false
			}
		);
		const workspaceId = created.workspace?.workspace_id;
		if (!workspaceId) throw error(500, 'workspace.create returned no workspace id');

		// The new workspace's pane needs a moment to reach its shell prompt.
		await sleep(1500);

		const createdPane = await waitForWorkspacePane(workspaceId, () =>
			herdr.request('session.snapshot')
		);
		if (!createdPane) throw error(504, 'new workspace did not publish its pane');
		paneId = createdPane;
		const shell = await readVisible(paneId).catch(() => '');

		const startParams = {
			name: herdrAgentName(label, kind),
			kind,
			pane_id: paneId,
			timeout_ms: 60_000,
			...(kind === 'omp'
				? { args: ['--cwd', directory ?? HOME, '--extension', OMP_STARTUP_EXTENSION] }
				: {})
		};
		try {
			await herdr.request('agent.start', startParams);
		} catch (cause) {
			// Display labels need not obey Herdr's lowercase machine-name rules.
			// A second pane may also use the same label; the pane id makes that
			// retry unique, and Herdr rejects duplicates before launching anything.
			if (!(cause instanceof HerdrRequestError) || cause.code !== 'agent_name_taken') throw cause;
			await herdr.request('agent.start', {
				...startParams,
				name: uniqueHerdrAgentName(startParams.name, paneId)
			});
		}
		await settleScreen(paneId, { before: shell, budgetMs: 30_000, stableMs: 1_500 });

		// A stable input screen is not enough: Pi can draw it before herdr has
		// registered the pane as a named agent. Returning in that gap makes the
		// first message fail with “not an active named agent”.
		if (!(await waitForActiveAgent(paneId))) {
			throw error(504, `${kind} started but is not ready to receive messages`);
		}

		if (kind === 'omp' && initialPrompt) {
			// OMP trims text submitted by its terminal input controller. This
			// single-line marker survives that boundary; the startup extension
			// decodes it and submits the original text through OMP's message API.
			await sendText(paneId, encodeOmpStartupPrompt(initialPrompt));
			await sendKeys(paneId, ['enter']);

			// Herdr reports the session before OMP always flushes its first
			// message. Do not return during that gap: the first detail request
			// would otherwise show the false integration-reinstall warning.
			const deadline = Date.now() + 30_000;
			let transcriptReady = false;
			while (Date.now() < deadline) {
				const raw = await rawAgent(paneId);
				const sessionId = (raw?.agent_session as { value?: string } | undefined)?.value;
				const path = sessionId ? await piAdapter.resolve(sessionId) : null;
				if (path) {
					const messages = piAdapter.parse((await readTranscriptTail(path)).text);
					if (messages.some((message) => message.role === 'user')) {
						transcriptReady = true;
						break;
					}
				}
				await sleep(250);
			}
			if (!transcriptReady) {
				throw error(504, 'OMP started but did not create its transcript');
			}
		}

		return json({ ok: true, paneId });
	} catch (e) {
		if (e instanceof HerdrRequestError) {
			// Other harnesses can start on a first-run prompt. OMP must get as
			// far as its first transcript above before creation is complete.
			if (e.code === 'agent_not_ready' && paneId && kind !== 'omp') {
				return json({ ok: true, paneId });
			}
			throw error(409, e.message);
		}
		// A socket error is a plain Error, which SvelteKit would render as a
		// bare "Internal Error" in the sheet. Say what actually happened.
		if (e instanceof Error && !('status' in e)) {
			throw error(503, `herdr is not reachable: ${e.message}`);
		}
		throw e;
	}
};
