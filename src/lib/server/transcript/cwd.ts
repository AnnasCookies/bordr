/**
 * The directory the AGENT is working in, read from its own transcript.
 *
 * herdr reports the pane's cwd — the shell's. An agent moves independently of
 * it: `cd` inside a tool call changes where the agent works and never touches
 * the shell that launched it, so a pane sat in `~` can be running an agent
 * that has been in `~/bordr` for an hour. The header should say where the work
 * is, not where the terminal was opened.
 *
 * Every harness bordr reads records this, in one of two shapes:
 *
 *   Claude Code  `cwd` at the top level of EVERY line, so it tracks a `cd`
 *                as the session goes on.
 *   omp / pi     `cwd` at the top level of one metadata line.
 *   Codex        `payload.cwd` on the opening `session_meta` line.
 *
 * Lines are walked newest-first so a harness that re-states the directory wins
 * with its latest value, and one that states it once is still found.
 */

/** How many lines back to look before giving up. */
const MAX_LINES = 2000;

/**
 * Read `cwd` from one parsed line, top level or one level into `payload`.
 *
 * Deliberately NOT a regex over the raw text: a transcript is full of tool
 * output, and this very session printed `"cwd":"/home/tony"` from a herdr
 * command into its own log. A regex would have read that back as the answer.
 * Only these two positions are the harness speaking.
 */
function cwdOf(line: unknown): string {
	if (typeof line !== 'object' || line === null) return '';
	const row = line as { cwd?: unknown; payload?: { cwd?: unknown } };
	if (typeof row.cwd === 'string' && row.cwd) return row.cwd;
	const nested = row.payload?.cwd;
	return typeof nested === 'string' && nested ? nested : '';
}

/**
 * The agent's working directory, or '' when the transcript does not say.
 *
 * '' rather than a guess: the caller falls back to the pane's cwd, which is
 * wrong in a different way but at least true of something.
 */
export function agentCwd(jsonl: string): string {
	const lines = jsonl.split('\n');
	// The window is a TAIL, so its first line is usually a fragment of one that
	// started before the window. It fails to parse and is skipped like any
	// other unreadable line.
	const stop = Math.max(0, lines.length - MAX_LINES);
	for (let i = lines.length - 1; i >= stop; i--) {
		const line = lines[i].trim();
		if (!line) continue;
		try {
			const found = cwdOf(JSON.parse(line));
			if (found) return found;
		} catch {
			// Not a whole JSON line — a fragment at the window edge, or a blank.
		}
	}
	return '';
}
