/**
 * The reasoning effort, out of the harness's own status line.
 *
 * The status line is a LAST RESORT and is treated as one. It is the user's,
 * not the harness's — omp's is fully configurable, fields and glyphs and
 * order — so anything read from it works on the machine it was written
 * against and may find nothing, or the wrong field, on anybody else's.
 *
 * The model no longer comes from here; it is in the transcript, structurally,
 * for both harnesses (see `server/transcript/model.ts`). Effort is not, in
 * either of them, and herdr has no concept of it — so this is the only place
 * it exists at all, and the choice is between a guarded guess and nothing.
 *
 * The guard is a fixed vocabulary. Rather than trusting whatever text follows
 * the glyph, only a value that is recognisably an effort level is accepted, so
 * a status line laid out differently yields NOTHING instead of announcing
 * somebody's git branch as their reasoning effort.
 */

/** The statusline's mark for the model, and for the effort. */
const MODEL_MARK = '\u{f06a9}';
const EFFORT_MARK = '\u{f04c5}';

/**
 * What an effort level is allowed to be.
 *
 * Every level the two harnesses offer. Anything else that happens to sit
 * behind the same glyph in somebody's own layout is not an effort and is
 * discarded — the same glyph labels a spend row two lines further down.
 */
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto']);

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
	/**
	 * The model as the status line names it.
	 *
	 * Only a fallback now — the transcript is the real source — for a harness
	 * whose transcript bordr cannot read.
	 */
	model: string;
	/** Reasoning effort, or '' when the line does not clearly carry one. */
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
		const effort = fieldAfter(line, EFFORT_MARK).toLowerCase();
		return { model, effort: EFFORTS.has(effort) ? effort : '' };
	}
	return { model: '', effort: '' };
}
