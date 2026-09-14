/**
 * Enough markdown for a one-line preview, and no more.
 *
 * A preview is the agent's own prose, which is markdown, shown as a single
 * clipped line. Rendered raw it reads as punctuation: `**What I found** - **`
 * `git push` caused 131 prompts**`. The full renderer is the wrong tool —
 * it produces block elements and pulls in marked and DOMPurify for a line of
 * text that is already 80 characters long.
 *
 * So: block markers are dropped, a few inline spans are kept as marks, and
 * anything ambiguous stays as the literal characters the agent wrote.
 *
 * The clip happens BEFORE this runs, so a preview very often ends mid-span:
 * `**Done, and the ma…`. An unterminated marker is therefore not an error to
 * recover from, it is the normal case, and it must come out as plain text
 * rather than swallowing the rest of the line.
 */

export type Mark = 'plain' | 'strong' | 'code';

export interface Segment {
	text: string;
	mark: Mark;
}

/** Block syntax at the very start of the line, which is noise in a preview. */
const LEAD = /^(?:\s*(?:>|#{1,6}|[-*+]|\d+[.)])\s+)+/;

/**
 * The preview is several lines collapsed into one, so a heading can turn up
 * in the middle of it: `corrected in ctxc. ## LL-FH = …`.
 *
 * TWO hashes minimum, with a space either side. A single `#` mid-sentence is
 * far more often an issue number or a C# than a heading, and `#8376` has no
 * space after it — requiring both is what keeps those safe.
 */
const MID_HEADING = /\s#{2,6}\s+/g;

/**
 * A table's delimiter row, which collapses into `| | | |---|---| |` and is
 * pure punctuation once the line breaks are gone. The cells around it are
 * worth keeping; this row never is.
 */
const TABLE_RULE = /\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?/g;

/**
 * What the rule leaves behind: the table's empty cells, as a run of bare
 * pipes. One separator says the same thing and reads as text rather than as
 * a broken table.
 */
const EMPTY_CELLS = /(?:\|\s*){2,}/g;

/**
 * `[label](target)` → `label`. A preview has nowhere to put a link, and the
 * target is usually longer than the whole line is allowed to be.
 */
function delink(text: string): string {
	return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/** One inline span: code first, because backticks win over everything. */
const SPAN = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__/;

/**
 * Split a preview into styled runs.
 *
 * Always returns at least one segment for a non-empty input, so a caller can
 * render the result without a special case for "no markup at all".
 */
export function previewSegments(input: string): Segment[] {
	const text = delink(
		input
			.replace(LEAD, '')
			.replace(TABLE_RULE, ' ')
			.replace(EMPTY_CELLS, '| ')
			.replace(MID_HEADING, ' ')
	).replace(/\s{2,}/g, ' ');
	const out: Segment[] = [];
	let rest = text;

	while (rest) {
		const found = SPAN.exec(rest);
		if (!found) break;
		const before = rest.slice(0, found.index);
		if (before) out.push({ text: before, mark: 'plain' });
		// Whichever group matched: code, then the two spellings of strong.
		const code = found[1];
		out.push({ text: code ?? found[2] ?? found[3], mark: code ? 'code' : 'strong' });
		rest = rest.slice(found.index + found[0].length);
	}
	if (rest) out.push({ text: rest, mark: 'plain' });

	// Emphasis is left alone deliberately. A single `*` is as often a literal
	// asterisk in a shell command or a glob as it is markdown, and at this
	// size italic buys nothing worth a wrong guess.
	return out.length > 0 ? out : [{ text, mark: 'plain' }];
}

/** The same thing with every mark thrown away — for a title or an aria label. */
export function previewPlain(input: string): string {
	return previewSegments(input)
		.map((s) => s.text)
		.join('');
}
