import { error, json } from '@sveltejs/kit';
import { rawAgent, rawPane, toSummary } from '$lib/server/herdr';
import { adapterFor } from '$lib/server/transcript';
import { resolveLocalTranscript } from '$lib/server/transcript/resolve';
import { readSubagent } from '$lib/server/transcript/subagents';
import { backfillBlocks } from '$lib/server/transcript/types';
import type { RequestHandler } from './$types';

/**
 * One sub-agent's conversation.
 *
 * Parsed with the SAME adapter as the session that spawned it — a sub-agent's
 * transcript is the same format, so its tool calls, diffs and thinking render
 * the way they do everywhere else rather than as a wall of JSON.
 *
 * Its own endpoint rather than riding along with the detail payload: only one
 * is ever open at a time, and a session can hold a dozen of them.
 */
export const GET: RequestHandler = async ({ params }) => {
	const raw = (await rawAgent(params.pane)) ?? (await rawPane(params.pane));
	if (!raw) throw error(404, `no pane ${params.pane}`);
	const summary = toSummary(raw);

	const adapter = adapterFor(summary.agent, { child: true });
	if (!adapter) throw error(404, `no transcript adapter for ${summary.agent || 'this pane'}`);

	const sessionId = (raw.agent_session as { value?: string } | undefined)?.value;
	if (!sessionId) throw error(404, 'this pane reported no session');

	const path = await resolveLocalTranscript(adapter, summary.paneId, summary.agent, sessionId);
	if (!path) throw error(404, 'the session transcript was not found');

	const text = await readSubagent(path, params.id);
	if (text === null) throw error(404, 'no such sub-agent in this session');

	return json({ messages: adapter.parse(text).map(backfillBlocks) });
};
