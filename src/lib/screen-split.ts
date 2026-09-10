/**
 * Cut a terminal screen at the harness's own prompt row.
 *
 * Terminal mode puts bordr's input box exactly where the harness draws its
 * input, so what is above stays screen, the prompt row becomes a real text
 * box, and whatever the harness draws BELOW its prompt — the status footer —
 * is handed to the status block, which already knows how to park it, hide it
 * and snap to the row you care about.
 *
 * Recognising the row is the whole problem. Every harness draws it
 * differently — `❯` after a shell's git prompt, `>` inside a rounded box in
 * Claude Code, `›` in pi — but they all end in a marker with nothing but
 * cursor after it, and they all sit below the last real output.
 */
export interface ScreenParts {
	/** Everything above the prompt: the pane's output. */
	above: string[];
	/** The prompt row itself, or '' when none was found. */
	prompt: string;
	/** What the harness draws under its prompt, usually a status footer. */
	below: string[];
}

/** Strip the escape sequences, for matching only. */
export function plain(line: string): string {
	// eslint-disable-next-line no-control-regex -- matching terminal output means matching escapes
	return line.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\u001b\][^]*/g, '');
}

/**
 * A prompt marker with nothing of substance after it.
 *
 * Two rules, and both are needed. Nothing may follow the marker, so a line
 * that merely CONTAINS one — a git log, a diff, a quoted shell command — is
 * not the place you type. And something ordinary must PRECEDE it: a space, a
 * box edge, or the `~`/`]`/`)` a shell prompt ends its path with. Without
 * that second rule a progress line ending `40%` reads as a prompt.
 */
const PROMPT = /(?:^|[\s│┃|~\])])([❯➜›»▶>$#%])\s*$/;

/** A box border or rule: furniture around the prompt, not content. */
const RULE = /^[\s─═━╌┄┈╭╮╰╯┌┐└┘├┤┬┴┼│┃▔▁_]*$/;

export function splitAtPrompt(screen: string): ScreenParts {
	const lines = screen.split('\n');
	// Trailing blank rows are the terminal's empty space, not part of the
	// footer; keeping them would push the input box up the screen.
	let end = lines.length;
	while (end > 0 && plain(lines[end - 1]).trim() === '') end--;

	for (let i = end - 1; i >= 0; i--) {
		const bare = plain(lines[i]).trimEnd();
		if (!PROMPT.test(bare)) continue;
		// A harness pads the space between its last output and its input box
		// with empty rows. Keeping them put that padding between the output and
		// bordr's own box — a screenful of nothing, on every pane.
		let top = i;
		while (top > 0 && plain(lines[top - 1]).trim() === '') top--;
		return {
			above: lines.slice(0, top),
			prompt: lines[i],
			// The rules that box a prompt belong to the prompt, not to the footer
			// under it — carrying them down draws half a box.
			below: lines.slice(i + 1, end).filter((l) => !RULE.test(plain(l)))
		};
	}
	return { above: lines.slice(0, end), prompt: '', below: [] };
}

/** The marker a prompt row ends with, so ours can match it. */
export function promptMark(prompt: string): string {
	return plain(prompt).trimEnd().match(PROMPT)?.[1] ?? '›';
}
