import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { claudeRunEnded, isDone, resolvedToolUseTimes } from './subagent-done';

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
 *
 * Pi's subagent package keeps the same useful boundary but a different tree:
 *
 *   <project>/<sessionId>/<child uuid>/run-N/session.jsonl
 *
 * Its `session_info` row carries the agent and run id. We read those child
 * transcripts directly; terminal glyphs and temporary async logs are not an
 * API and disappear on reboot.
 */

export interface SubagentSummary {
	/** A strict file-derived id, used to address it without accepting a path. */
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

function sessionDir(transcriptPath: string): string {
	const session = basename(transcriptPath).replace(/\.jsonl$/, '');
	return join(dirname(transcriptPath), session);
}

/** Where a Claude session's sub-agent transcripts live, given the session's own. */
export function subagentsDir(transcriptPath: string): string {
	return join(sessionDir(transcriptPath), 'subagents');
}

const PI_CHILD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PI_RUN = /^run-(\d+)$/;
const PI_ID = /^pi-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(run-\d+)$/i;
const PI_NAME =
	/^subagent-(.+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d+)$/i;

function brief(text: string, max = 120): string {
	const line = text.replace(/\s+/g, ' ').trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function messageText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((part) => {
			if (typeof part !== 'object' || part === null) return '';
			const block = part as { type?: string; text?: string };
			return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
		})
		.filter(Boolean)
		.join('\n');
}

/**
 * Whether a Pi child's last assistant turn ended its run.
 *
 * pi-ai's StopReason is more than `stop`. `error` and `aborted` end the agent
 * loop on the spot, before any tool call in that message is run, so a call
 * left unanswered there never will be; treating only `stop` as finished showed
 * a failed child as running forever. `length` ends it too unless the cut-off
 * message asked for tools: Pi then fails those calls and asks the model again,
 * exactly as `stop` would carry on after a tool call.
 */
function piRunEnded(stopReason: string, calledTools: boolean, unanswered: number): boolean {
	if (stopReason === 'error' || stopReason === 'aborted') return true;
	if (stopReason === 'stop' || stopReason === 'length') return !calledTools && unanswered === 0;
	return false;
}

/** Read only the lifecycle fields needed for the strip; the full adapter runs only when opened. */
function scanPiSession(text: string) {
	let agentType = 'Pi subagent';
	let runId = '';
	let description = '';
	let entries = 0;
	let lastAt = 0;
	let lastRole = '';
	let stopReason = '';
	/** Whether the latest assistant message asked for any tool. */
	let calledTools = false;
	const pending = new Set<string>();
	for (const line of text.split('\n')) {
		if (!line.trim()) continue;
		entries++;
		try {
			const entry = JSON.parse(line) as {
				type?: string;
				name?: string;
				timestamp?: string;
				message?: {
					role?: string;
					content?: unknown;
					toolCallId?: string;
					stopReason?: string;
				};
			};
			const at = Date.parse(entry.timestamp ?? '');
			if (at) lastAt = at;
			const name = entry.type === 'session_info' ? PI_NAME.exec(entry.name ?? '') : null;
			if (name) [agentType, runId] = [name[1], name[2]];
			if (entry.type !== 'message' || !entry.message) continue;
			const message = entry.message;
			if (message.role === 'toolResult') {
				if (message.toolCallId) pending.delete(message.toolCallId);
				continue;
			}
			if (message.role !== 'user' && message.role !== 'assistant') continue;
			lastRole = message.role;
			stopReason = message.stopReason ?? '';
			calledTools = false;
			if (message.role === 'user' && !description)
				description = brief(messageText(message.content));
			if (message.role === 'assistant' && Array.isArray(message.content)) {
				for (const part of message.content) {
					if (typeof part !== 'object' || part === null) continue;
					const block = part as { type?: string; id?: string };
					if (block.type !== 'toolCall') continue;
					calledTools = true;
					if (block.id) pending.add(block.id);
				}
			}
		} catch {
			// A half-written final line is normal while a child is running.
		}
	}
	return {
		agentType,
		runId,
		description,
		entries,
		lastAt,
		done: lastRole === 'assistant' && piRunEnded(stopReason, calledTools, pending.size)
	};
}

type PiScan = ReturnType<typeof scanPiSession>;

/**
 * Scans of Pi child transcripts, keyed by path and trusted while the file's
 * size and modification time are unchanged.
 *
 * The strip is rebuilt on every detail poll, every two seconds, and a session
 * can hold many finished runs that will never change again; reading and
 * parsing each of them in full on every poll was the same work for nothing.
 * Least recently used goes first, so a long-lived server that has seen many
 * sessions keeps the runs it is still being asked about.
 */
const PI_SCAN_LIMIT = 256;
const piScans = new Map<string, { size: number; mtimeMs: number; scan: PiScan }>();

async function scanPiFile(path: string): Promise<PiScan> {
	const { size, mtimeMs } = await stat(path);
	const cached = piScans.get(path);
	piScans.delete(path);
	if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
		piScans.set(path, cached);
		return cached.scan;
	}
	// Stat first, then read: a write landing in between leaves the stored size
	// behind the content, which only costs one extra read on the next poll.
	const scan = scanPiSession(await readFile(path, 'utf8'));
	piScans.set(path, { size, mtimeMs, scan });
	if (piScans.size > PI_SCAN_LIMIT) piScans.delete(piScans.keys().next().value as string);
	return scan;
}

/** Pi stores each child in `<session>/<child uuid>/run-N/session.jsonl`. */
async function listPiSubagents(transcriptPath: string): Promise<SubagentSummary[]> {
	const root = sessionDir(transcriptPath);
	let children: Dirent[];
	try {
		children = await readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}

	const out: SubagentSummary[] = [];
	for (const child of children) {
		if (!child.isDirectory() || !PI_CHILD.test(child.name)) continue;
		let runs: Dirent[];
		try {
			runs = await readdir(join(root, child.name), { withFileTypes: true });
		} catch {
			continue;
		}
		for (const run of runs) {
			if (!run.isDirectory() || !PI_RUN.test(run.name)) continue;
			try {
				const session = await scanPiFile(join(root, child.name, run.name, 'session.jsonl'));
				out.push({
					id: `pi-${child.name}-${run.name}`,
					agentType: session.agentType,
					description: session.description,
					toolUseId: session.runId,
					spawnDepth: 1,
					parentAgentId: '',
					entries: session.entries,
					lastAt: session.lastAt,
					done: session.done
				});
			} catch {
				// A run directory can exist just before its transcript does.
			}
		}
	}
	return out;
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
 * A Claude sidecar without its transcript, or a Pi run directory without its
 * session file, is skipped rather than half-reported: an agent you cannot open
 * is worse than one you cannot see, because it looks like a fault in bordr.
 */
export async function listSubagents(
	transcriptPath: string,
	/** The session's own transcript, already read by the caller. */
	sessionText = ''
): Promise<SubagentSummary[]> {
	const dir = subagentsDir(transcriptPath);
	let names: string[] = [];
	try {
		names = await readdir(dir);
	} catch {
		// Claude has no sidecar directory; Pi may still have child run folders.
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
				ended: claudeRunEnded(text),
				text
			} as SubagentSummary & { text: string; ended: boolean });
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
	const withText = out as Array<SubagentSummary & { text: string; ended: boolean }>;
	const byId = new Map(withText.map((a) => [a.id, a.text]));
	const resolvedIn = new Map<string, Map<string, number>>();
	const resolvedFor = (parentAgentId: string): Map<string, number> => {
		const key = parentAgentId || '\u0000session';
		const cached = resolvedIn.get(key);
		if (cached) return cached;
		const source = parentAgentId ? (byId.get(`agent-${parentAgentId}`) ?? '') : sessionText;
		const found = resolvedToolUseTimes(source);
		resolvedIn.set(key, found);
		return found;
	};

	for (const agent of withText) {
		agent.done = agent.ended || isDone(agent, resolvedFor(agent.parentAgentId));
	}
	// The transcripts themselves were only ever needed to answer that; sending
	// several megabytes of them to a phone would be absurd.
	for (const agent of withText) {
		delete (agent as { text?: string }).text;
		delete (agent as { ended?: boolean }).ended;
	}

	return [...out, ...(await listPiSubagents(transcriptPath))].sort((a, b) => b.lastAt - a.lastAt);
}

/** One sub-agent's raw transcript, for the adapter to parse. */
export async function readSubagent(transcriptPath: string, id: string): Promise<string | null> {
	// Every accepted id has a closed shape, so neither form can address a path.
	if (/^agent-[A-Za-z0-9_-]+$/.test(id)) {
		try {
			return await readFile(join(subagentsDir(transcriptPath), `${id}.jsonl`), 'utf8');
		} catch {
			return null;
		}
	}
	const pi = PI_ID.exec(id);
	if (!pi) return null;
	try {
		return await readFile(join(sessionDir(transcriptPath), pi[1], pi[2], 'session.jsonl'), 'utf8');
	} catch {
		return null;
	}
}
