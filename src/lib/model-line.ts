/**
 * The model and the effort, lifted out of the harness's own status line.
 *
 * It is already on screen — the top status row says it — but that row is a
 * dense line of glyphs, quotas and paths that you read when you go looking,
 * not something you notice. Which model a pane is on, and how hard it is
 * being asked to think, are the two facts you want at a glance, because they
 * are the ones that change what an answer is worth and what it costs.
 *
 * Read off the same screen the status block already comes from, so it costs
 * no extra call.
 *
 * Real lines, from three panes:
 *
 *   󰚩 Opus 5 󰓅 high  bordr · 󰑃 inline-worker · 🪨 LITE · ~/bordr
 *   󰚩 Opus 5 1M 󰓅 high · Auto mode permission prompts · 󰑃 inline-worker
 *   󰚩 CODEX PRO · OAuth subscription · 272.0K ctx · 128.0K out
 *
 * The last has no effort at all, which is the normal case for a harness that
 * does not have the concept.
 */

/** The statusline's mark for the model, and for the effort. */
const MODEL_MARK = '\u{f06a9}';
const EFFORT_MARK = '\u{f04c5}';

/**
 * Anything that ends a field: the next Nerd Font glyph, a middot separator, or
 * the end of the line.
 *
 * Private Use Area, because every mark in this line is one and naming them
 * individually would be a list that goes stale the first time the statusline
 * gains a field. An emoji counts too — 🪨 marks a field in the line above.
 */
const FIELD_END =
	/[\u{e000}-\u{f8ff}\u{f0000}-\u{ffffd}\u{100000}-\u{10fffd}\u{1f300}-\u{1faff}]|·/u;

export interface ModelLine {
	/** The model as the harness names it, or '' when it did not say. */
	model: string;
	/** Reasoning effort, or '' for a harness without the concept. */
	effort: string;
}

/** The text after `mark`, up to whatever ends the field. */
function fieldAfter(line: string, mark: string): string {
	const at = line.indexOf(mark);
	if (at === -1) return '';
	const rest = line.slice(at + mark.length);
	const end = rest.search(FIELD_END);
	return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/**
 * The model and effort from a harness's status lines.
 *
 * Both are taken from the SAME line. The effort mark is a speedometer, which
 * the same statusline also uses to label a spend row — reading it from
 * wherever it appeared first would report "RUN" as the effort.
 */
export function parseModelLine(lines: readonly string[]): ModelLine {
	for (const line of lines) {
		const model = fieldAfter(line, MODEL_MARK);
		if (!model) continue;
		return { model, effort: fieldAfter(line, EFFORT_MARK) };
	}
	return { model: '', effort: '' };
}
