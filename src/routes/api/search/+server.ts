import { json } from '@sveltejs/kit';
import { listAgents, rawAgents } from '$lib/server/herdr';
import { adapterFor } from '$lib/server/transcript';
import { MAX_TAIL_BYTES, readTranscriptTail } from '$lib/server/transcript/tail';
import { isEmptyQuery, matchIndex, matchLength, parseSearchQuery } from '$lib/server/search-query';
import type { RequestHandler } from './$types';

interface Hit {
	paneId: string;
	title: string;
	agent: string;
	role: string;
	snippet: string;
}

const MAX_HITS = 30;
/**
 * Per pane, so one chatty session cannot starve the rest. The global cap used
 * to break out of the pane loop itself: 30 hits came from 2 of 14 live panes
 * and the other 12 transcripts were never opened, so a term you remembered
 * from a specific session could return nothing at all.
 */
const MAX_PER_PANE = 5;
const CONTEXT = 70;

/**
 * Case-insensitive text search across every live agent's transcript.
 *
 * `q` supports quoted phrases, `-exclusions` and multiple terms that must all
 * appear; `role` and `agent` narrow further. Searching everything returns more
 * than is readable on a phone, and the per-pane cap means a broad term crowds
 * out the session you actually wanted.
 */
export const GET: RequestHandler = async ({ url }) => {
	const raw = url.searchParams.get('q')?.trim() ?? '';
	if (raw.length < 2) return json({ hits: [], truncated: false });

	const query = parseSearchQuery(raw);
	// "-noise" alone would otherwise match every message in every session.
	if (isEmptyQuery(query)) return json({ hits: [], truncated: false });

	const roleFilter = url.searchParams.get('role');
	const agentFilter = url.searchParams.get('agent');

	// One agent.list for the summaries and one for the raw session ids, rather
	// than a fresh socket round trip per pane inside the loop.
	const [agents, raws] = await Promise.all([
		listAgents().catch(() => []),
		rawAgents().catch(() => [] as Record<string, unknown>[])
	]);
	const byPane = new Map(raws.map((a) => [a.pane_id as string, a]));
	const hits: Hit[] = [];
	let truncated = false;

	for (const summary of agents) {
		if (agentFilter && summary.agent !== agentFilter) continue;
		const adapter = adapterFor(summary.agent);
		if (!adapter) continue;
		const raw = byPane.get(summary.paneId);
		const sessionId = (raw?.agent_session as { value?: string } | undefined)?.value;
		if (!sessionId) continue;
		const path = await adapter.resolve(sessionId);
		if (!path) continue;

		let messages;
		try {
			// Shares the mtime-keyed cache with the conversation view instead of
			// re-reading every transcript whole on each query — that was ~100MB
			// of uncached reads per search across the live panes.
			messages = adapter.parse((await readTranscriptTail(path, MAX_TAIL_BYTES)).text);
		} catch {
			continue;
		}
		let fromPane = 0;
		for (const message of messages) {
			if (roleFilter && message.role !== roleFilter) continue;
			const at = matchIndex(message.text, query);
			if (at === -1) continue;
			if (fromPane >= MAX_PER_PANE) {
				truncated = true;
				break;
			}
			const found = matchLength(message.text, query);
			const start = Math.max(0, at - CONTEXT);
			const end = at + found + CONTEXT;
			const snippet =
				(start > 0 ? '…' : '') +
				message.text.slice(start, end).replace(/\s+/g, ' ') +
				(end < message.text.length ? '…' : '');
			hits.push({
				paneId: summary.paneId,
				title: summary.title,
				agent: summary.agent,
				role: message.role,
				snippet
			});
			fromPane += 1;
		}
		if (hits.length >= MAX_HITS) {
			truncated = true;
			break;
		}
	}
	return json({ hits: hits.slice(0, MAX_HITS), truncated });
};
