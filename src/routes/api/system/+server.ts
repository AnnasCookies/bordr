import { error, json } from '@sveltejs/kit';
import {
	ACTIONS,
	listJobs,
	findUnit,
	listSessions,
	loadCommands,
	outdatedProcesses,
	runAction,
	type Action
} from '$lib/server/system';
import type { RequestHandler } from './$types';

/**
 * Host housekeeping: herdr's server and sessions, and the operator's own
 * commands. GET is the whole page's state, polled while a job runs; POST names
 * one action and starts it. See `$lib/server/system` for why nothing here
 * accepts a command, only the name of one.
 */
export const GET: RequestHandler = async () => {
	const [sessions, commands, outdated] = await Promise.all([
		listSessions().then(
			(list) => ({ list, error: null }),
			(e: unknown) => ({ list: [], error: e instanceof Error ? e.message : String(e) })
		),
		loadCommands(),
		outdatedProcesses()
	]);
	const current = sessions.list.find((s) => s.current);
	const unit = current ? await findUnit(current.name) : null;
	return json({
		sessions: sessions.list,
		unit,
		sessionsError: sessions.error,
		commands: commands.commands.map(({ id, label, confirm }) => ({ id, label, confirm })),
		commandsPath: commands.path,
		commandsError: commands.error,
		outdated,
		jobs: listJobs()
	});
};

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { action?: string; name?: string };
	const action = body.action as Action;
	if (!ACTIONS.includes(action)) throw error(400, `action must be one of ${ACTIONS.join(', ')}`);
	const name = typeof body.name === 'string' ? body.name : '';
	try {
		return json({ job: await runAction(action, name) });
	} catch (e) {
		// "already running", "no such session" — the refusal is the message.
		throw error(409, e instanceof Error ? e.message : String(e));
	}
};
