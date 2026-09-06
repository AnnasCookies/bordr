import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import { error, json } from '@sveltejs/kit';
import { getClient, HerdrRequestError, readVisible, settleScreen } from '$lib/server/herdr';
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
	const { kind, cwd, label } = (await request.json()) as {
		kind?: string;
		cwd?: string;
		label?: string;
	};
	if (!kind || !KINDS.has(kind)) throw error(400, `kind must be one of: ${[...KINDS].join(', ')}`);
	const directory = confinedCwd(cwd);

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

		const snapshot = await herdr.request<{
			snapshot?: { panes?: Array<{ pane_id?: string; workspace_id?: string }> };
		}>('session.snapshot');
		const pane = snapshot.snapshot?.panes?.find((p) => p.workspace_id === workspaceId);
		if (!pane?.pane_id) throw error(500, 'no pane found in new workspace');
		paneId = pane.pane_id;
		const shell = await readVisible(paneId).catch(() => '');

		await herdr.request('agent.start', {
			name: label?.trim() || kind,
			kind,
			pane_id: paneId,
			timeout_ms: 60_000
		});
		await settleScreen(paneId, { before: shell, budgetMs: 30_000, stableMs: 1_500 });

		return json({ ok: true, paneId });
	} catch (e) {
		if (e instanceof HerdrRequestError) {
			// agent_not_ready = started but sitting on a first-run prompt —
			// that IS a success for our purposes; the picker card handles it.
			// It is THIS pane that started, not the first agent of its kind.
			if (e.code === 'agent_not_ready' && paneId) return json({ ok: true, paneId });
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
