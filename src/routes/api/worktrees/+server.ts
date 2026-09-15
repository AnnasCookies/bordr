import { error, json } from '@sveltejs/kit';
import { createWorktree, listWorktrees, openWorktree } from '$lib/server/herdr/controls';
import { HerdrRequestError } from '$lib/server/herdr/client';
import type { RequestHandler } from './$types';

/**
 * The repository's checkouts, and making another one.
 *
 * Addressed by a PANE rather than a path on its own: the pane says which
 * machine the repository is on, and its cwd says which repository. A bare
 * path would be ambiguous the moment a second machine is connected.
 *
 * herdr refuses a cwd that is not inside a work tree, with a sentence worth
 * passing through — "Herdr worktree actions require a path inside a Git work
 * tree" says what to do and a 500 does not.
 */
function fail(e: unknown): never {
	const message = e instanceof Error ? e.message : String(e);
	throw error(e instanceof HerdrRequestError ? 409 : 502, message);
}

export const GET: RequestHandler = async ({ url }) => {
	const pane = url.searchParams.get('pane');
	const cwd = url.searchParams.get('cwd');
	if (!pane || !cwd) throw error(400, 'pane and cwd required');
	try {
		return json(await listWorktrees(pane, cwd));
	} catch (e) {
		fail(e);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		action?: string;
		pane?: string;
		cwd?: string;
		branch?: string;
		base?: string;
		path?: string;
	};
	if (!body.pane || !body.cwd) throw error(400, 'pane and cwd required');

	try {
		if (body.action === 'create') {
			const branch = (body.branch ?? '').trim();
			// herdr would take a null branch and detach; a worktree with no branch
			// is not what anyone means by "new worktree" from a phone.
			if (!branch) throw error(400, 'a branch name is required');
			await createWorktree(body.pane, body.cwd, branch, body.base ?? '');
		} else if (body.action === 'open') {
			if (!body.path) throw error(400, 'path required');
			await openWorktree(body.pane, body.cwd, body.path);
		} else {
			throw error(400, 'action must be create or open');
		}
	} catch (e) {
		// A SvelteKit error is already the answer; only herdr's needs wrapping.
		if (e && typeof e === 'object' && 'status' in e) throw e;
		fail(e);
	}

	return json({ ok: true });
};
