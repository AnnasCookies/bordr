/**
 * Which sub-agents have finished.
 *
 * The strip at the top of a conversation listed every sub-agent a session had
 * ever spawned, for as long as the session lived. Four research agents that
 * finished ninety minutes ago still sat across the header, growing the sticky
 * bar and pushing the transcript down, with nothing to say. A sub-agent that
 * is RUNNING is live information worth the space; one that has finished is an
 * archive, and archives do not belong in a header.
 *
 * The harness records the answer and bordr was not reading it. When a Task
 * finishes, its `tool_result` is written into the transcript of whoever
 * called it — the session's own file for a direct child, and the PARENT
 * SUB-AGENT'S file for anything deeper, which is why a depth-2 agent's result
 * is nowhere in the session transcript.
 */

/**
 * Every `tool_use` id that has a result in this transcript.
 *
 * One pass, ids only. The blocks are not otherwise parsed: this runs over a
 * file that can be megabytes and only ever answers one question about it.
 */
export function resolvedToolUses(jsonl: string): Set<string> {
	const done = new Set<string>();
	for (const line of jsonl.split('\n')) {
		if (!line.trim()) continue;
		// Cheap reject before the parse: the overwhelming majority of lines in a
		// transcript carry no tool result at all.
		if (!line.includes('tool_result')) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue; // a truncated final line while something is mid-write
		}
		if (parsed === null || typeof parsed !== 'object') continue;
		const content = (parsed as { message?: { content?: unknown } }).message?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (typeof block !== 'object' || block === null) continue;
			const b = block as { type?: string; tool_use_id?: string };
			if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') done.add(b.tool_use_id);
		}
	}
	return done;
}

/**
 * How long a sub-agent may be silent before it counts as finished.
 *
 * The fallback, for the case the exact signal cannot reach: a result written
 * outside the window of the parent transcript that was read. A live agent
 * writes an entry per tool call, so a couple of minutes of silence is not a
 * pause in the work — but the cost of being wrong is only that a finished
 * agent stays in the strip a little longer, so the window is generous.
 *
 * ponytail: a time-based fallback, not a liveness check. If the harness ever
 * records a status in the sidecar, read that instead and delete this.
 */
export const SILENT_MS = 120_000;

export interface DoneInput {
	/** The `tool_use` id of the Task that started it. */
	toolUseId: string;
	/** Epoch ms of its last written entry; 0 if it has written nothing. */
	lastAt: number;
}

/**
 * Has this sub-agent finished?
 *
 * `resolved` is the set of tool ids answered in its parent's transcript —
 * exact, and the reason this is not a pure timer.
 */
export function isDone(agent: DoneInput, resolved: Set<string>, now: number): boolean {
	if (agent.toolUseId && resolved.has(agent.toolUseId)) return true;
	// Nothing written at all: it has only just been dispatched, so it is
	// running by definition, however long ago the sidecar appeared.
	if (agent.lastAt <= 0) return false;
	return now - agent.lastAt > SILENT_MS;
}
