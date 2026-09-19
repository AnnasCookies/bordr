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
 * Terminal states written by Claude's async task notifications.
 *
 * These are lifecycle data from the harness. A plain user or assistant message
 * cannot match because notifications live only in top-level queue/attachment
 * fields below.
 */
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'killed', 'stopped']);

/**
 * When each Task call finished, keyed by its tool-use id.
 *
 * Newer Claude versions return an immediate `tool_result` when an async agent
 * is merely launched, then publish the real outcome as a `task-notification`.
 * Treating every result as completion made a fresh agent disappear; once that
 * launch row fell outside Bordr's transcript tail it came back and spun for
 * ever. Timestamps also matter because Claude can resume the same child after
 * a completion notification.
 */
export function resolvedToolUseTimes(jsonl: string): Map<string, number> {
	const done = new Map<string, number>();
	const record = (id: string, at: number) => {
		const previous = done.get(id) ?? 0;
		if (at >= previous) done.set(id, at);
	};

	for (const line of jsonl.split('\n')) {
		if (!line.trim()) continue;
		// Cheap reject before the parse: almost every transcript row is neither.
		if (!line.includes('tool_result') && !line.includes('<task-notification>')) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue; // a truncated final line while something is mid-write
		}
		if (parsed === null || typeof parsed !== 'object') continue;
		const row = parsed as {
			timestamp?: string;
			message?: { content?: unknown };
			toolUseResult?: { status?: string };
			content?: unknown;
			attachment?: { prompt?: unknown };
		};
		const parsedAt = Date.parse(row.timestamp ?? '');
		// Fixtures and old transcripts may omit a timestamp. An exact result is
		// still stronger than a guess, so Infinity keeps the old shape useful.
		const at = Number.isFinite(parsedAt) ? parsedAt : Number.POSITIVE_INFINITY;

		if (row.toolUseResult?.status !== 'async_launched' && Array.isArray(row.message?.content)) {
			for (const block of row.message.content) {
				if (typeof block !== 'object' || block === null) continue;
				const result = block as { type?: string; tool_use_id?: string };
				if (result.type === 'tool_result' && typeof result.tool_use_id === 'string')
					record(result.tool_use_id, at);
			}
		}

		// Claude writes this first as a queue operation and may repeat it inside
		// an attachment. Either is data from the harness, not prose to execute.
		for (const value of [row.content, row.attachment?.prompt]) {
			if (typeof value !== 'string' || !value.includes('<task-notification>')) continue;
			const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(value)?.[1]?.trim();
			const status = /<status>([^<]+)<\/status>/.exec(value)?.[1]?.trim();
			if (id && status && TERMINAL_TASK_STATUSES.has(status)) record(id, at);
		}
	}
	return done;
}

/** Kept as the small ids-only helper used by existing callers and tests. */
export function resolvedToolUses(jsonl: string): Set<string> {
	return new Set(resolvedToolUseTimes(jsonl).keys());
}

/** Whether the child transcript itself says the current Claude run stopped. */
export function claudeRunEnded(jsonl: string): boolean {
	const lines = jsonl.split('\n');
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (!line) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (parsed === null || typeof parsed !== 'object') continue;
		const row = parsed as {
			type?: string;
			message?: { role?: string; stop_reason?: string | null };
		};
		if (row.type !== 'assistant' && row.type !== 'user') continue;
		if (row.message?.role === 'user' || row.type === 'user') return false;
		if (row.message?.role === 'assistant' || row.type === 'assistant')
			return row.message?.stop_reason === 'end_turn';
	}
	return false;
}

export interface DoneInput {
	/** The `tool_use` id of the Task that started it. */
	toolUseId: string;
	/** Epoch ms of its last written entry; 0 if it has written nothing. */
	lastAt: number;
}

/**
 * Has this sub-agent finished?
 *
 * `resolved` maps tool ids to the time they were answered in the parent's
 * transcript — exact, and new enough to distinguish a later resumed run.
 */
export function isDone(agent: DoneInput, resolved: ReadonlyMap<string, number>): boolean {
	if (!agent.toolUseId) return false;
	const resolvedAt = resolved.get(agent.toolUseId);
	if (resolvedAt === undefined) return false;
	// A later child write means the same resumable agent started another run.
	return !agent.lastAt || resolvedAt >= agent.lastAt;
}
