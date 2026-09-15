import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { isDone, resolvedToolUses } from './subagent-done';

/**
 * Claude Code's sub-agents, which have their own transcripts.
 *
 * A `Task` call spawns an agent that runs its own conversation, and until now
 * none of it reached the phone: bordr's adapter skips `isSidechain` entries in
 * the main file, so a Task row said a sub-agent had been dispatched and
 * nothing more. Whether it was still going, what it had found, whether it had
 * failed — none of it was reachable.
 *
 * They are not buried in the main transcript. Each gets its own file beside
 * the session:
 *
 *   <project>/<sessionId>.jsonl              the conversation
 *   <project>/<sessionId>/subagents/
 *       agent-<id>.jsonl                     the sub-agent's own transcript
 *       agent-<id>.meta.json                 what it is and who asked for it
 *
 * `toolUseId` in the sidecar is the `tool_use` id of the `Task` call that
 * started it, which is what lets a row in the transcript point at one.
 */

export interface SubagentSummary {
	/** The `agent-<id>` stem, used to address it. */
	id: string;
	/** The agent kind — 'Explore', 'general-purpose', a plugin agent. */
	agentType: string;
	/** The one-line description the caller gave it. */
	description: string;
	/** The `tool_use` id of the Task call that spawned it. */
	toolUseId: string;
	/** How deep in a chain of agents spawning agents. 1 is a direct child. */
	spawnDepth: number;
	/** Lines in its transcript — a cheap "how much has it done". */
	entries: number;
	/** Epoch ms of its last entry, or 0 when it has written nothing yet. */
	lastAt: number;
	/**
	 * Finished, rather than still working.
	 *
	 * Read from the harness's own record where it can be: a Task's result is
	 * written into the transcript of whoever called it. A deeper agent's result
	 * lands in its PARENT sub-agent's file, which is why `parentAgentId` is
	 * followed rather than only the session's own transcript being searched.
	 */
	done: boolean;
	/** The sub-agent that spawned it, for anything deeper than a direct child. */
	parentAgentId: string;
}

/** Where a session's sub-agent transcripts live, given the session's own. */
export function subagentsDir(transcriptPath: string): string {
	const session = basename(transcriptPath).replace(/\.jsonl$/, '');
	return join(dirname(transcriptPath), session, 'subagents');
}

/** The timestamp of the last entry, without parsing the whole file. */
function lastTimestamp(text: string): number {
	const lines = text.split('\n');
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (!line) continue;
		try {
			const at = Date.parse((JSON.parse(line) as { timestamp?: string }).timestamp ?? '');
			if (at) return at;
		} catch {
			// A half-written final line is normal while an agent is running.
		}
	}
	return 0;
}

/**
 * Every sub-agent of a session, newest activity first.
 *
 * A sidecar without its transcript, or the other way round, is skipped rather
 * than half-reported: an agent you cannot open is worse than one you cannot
 * see, because it looks like a fault in bordr.
 */
export async function listSubagents(
	transcriptPath: string,
	/** The session's own transcript, already read by the caller. */
	sessionText = ''
): Promise<SubagentSummary[]> {
	const dir = subagentsDir(transcriptPath);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		// No sub-agents have ever run in this session.
		return [];
	}

	const out: SubagentSummary[] = [];
	for (const name of names) {
		if (!name.endsWith('.meta.json')) continue;
		const id = name.replace(/\.meta\.json$/, '');
		try {
			const meta = JSON.parse(await readFile(join(dir, name), 'utf8')) as Record<string, unknown>;
			const text = await readFile(join(dir, `${id}.jsonl`), 'utf8');
			out.push({
				id,
				agentType: typeof meta.agentType === 'string' ? meta.agentType : 'agent',
				description: typeof meta.description === 'string' ? meta.description : '',
				toolUseId: typeof meta.toolUseId === 'string' ? meta.toolUseId : '',
				spawnDepth: typeof meta.spawnDepth === 'number' ? meta.spawnDepth : 1,
				parentAgentId: typeof meta.parentAgentId === 'string' ? meta.parentAgentId : '',
				entries: text.split('\n').filter((l) => l.trim()).length,
				lastAt: lastTimestamp(text),
				// Filled in below, once every sibling's text has been read: a
				// deeper agent's result lives in one of them.
				done: false,
				text
			} as SubagentSummary & { text: string });
		} catch {
			// Unreadable, or a sidecar whose transcript has not appeared yet.
		}
	}
	/**
	 * Whose transcript answers each agent: the session's for a direct child,
	 * its parent sub-agent's for anything deeper. Resolved once per file rather
	 * than per agent — four siblings of one parent would otherwise scan the
	 * same megabyte four times.
	 */
	const withText = out as Array<SubagentSummary & { text: string }>;
	const byId = new Map(withText.map((a) => [a.id, a.text]));
	const resolvedIn = new Map<string, Set<string>>();
	const resolvedFor = (parentAgentId: string): Set<string> => {
		const key = parentAgentId || '\u0000session';
		const cached = resolvedIn.get(key);
		if (cached) return cached;
		const source = parentAgentId ? (byId.get(`agent-${parentAgentId}`) ?? '') : sessionText;
		const found = resolvedToolUses(source);
		resolvedIn.set(key, found);
		return found;
	};

	for (const agent of withText) {
		agent.done = isDone(agent, resolvedFor(agent.parentAgentId));
	}
	// The transcripts themselves were only ever needed to answer that; sending
	// several megabytes of them to a phone would be absurd.
	for (const agent of withText) delete (agent as { text?: string }).text;

	return out.sort((a, b) => b.lastAt - a.lastAt);
}

/** One sub-agent's raw transcript, for the adapter to parse. */
export async function readSubagent(transcriptPath: string, id: string): Promise<string | null> {
	// The id addresses a file, so it must not be able to address a directory.
	if (!/^agent-[A-Za-z0-9_-]+$/.test(id)) return null;
	try {
		return await readFile(join(subagentsDir(transcriptPath), `${id}.jsonl`), 'utf8');
	} catch {
		return null;
	}
}
