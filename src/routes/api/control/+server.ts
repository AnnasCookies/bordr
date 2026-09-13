import { error, json } from '@sveltejs/kit';
import { close, focus, rename, type Scope } from '$lib/server/herdr/controls';
import { HerdrRequestError } from '$lib/server/herdr/client';
import type { RequestHandler } from './$types';

/**
 * herdr's own controls — focus, rename, close — for a pane, tab or workspace.
 *
 * One endpoint rather than nine: the three actions take the same shape and
 * differ only in which herdr method they end up calling, so a route each
 * would be the same handler copied out with a word changed.
 *
 * POST bodies are already covered by the CSRF and Host guards in
 * `hooks.server.ts`, which is what makes a mutating endpoint safe to add here
 * at all.
 */
const SCOPES: Scope[] = ['pane', 'tab', 'workspace'];
const ACTIONS = ['focus', 'rename', 'close'] as const;
type Action = (typeof ACTIONS)[number];

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		action?: string;
		scope?: string;
		id?: string;
		label?: string;
	};

	const action = body.action as Action;
	const scope = body.scope as Scope;
	if (!ACTIONS.includes(action)) throw error(400, `action must be one of ${ACTIONS.join(', ')}`);
	if (!SCOPES.includes(scope)) throw error(400, `scope must be one of ${SCOPES.join(', ')}`);
	if (typeof body.id !== 'string' || !body.id) throw error(400, 'id required');
	// A workspace holds every tab in it; herdr offers no single call that ends
	// one, and building it out of tab closes is not something to do from a
	// phone by accident.
	if (action === 'close' && scope === 'workspace') {
		throw error(400, 'close a workspace from herdr itself');
	}
	// A tab or workspace has no "no name" state — herdr takes a string and
	// would happily create one called "". Only a pane can be cleared, by
	// sending null, so only a pane may be renamed to nothing.
	const label = typeof body.label === 'string' ? body.label.trim() : '';
	if (action === 'rename' && !label && scope !== 'pane') {
		throw error(400, `a ${scope} needs a name`);
	}

	try {
		if (action === 'focus') await focus(scope, body.id);
		else if (action === 'close') await close(scope as 'pane' | 'tab', body.id);
		else await rename(scope, body.id, label);
	} catch (e) {
		// herdr's own refusal is the useful message — "no such pane", a machine
		// that is not reachable — so it is passed through rather than flattened
		// into a 500 the phone cannot act on.
		const message = e instanceof Error ? e.message : String(e);
		throw error(e instanceof HerdrRequestError ? 409 : 502, message);
	}

	return json({ ok: true });
};
