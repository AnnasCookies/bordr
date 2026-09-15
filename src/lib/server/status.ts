/**
 * Lift a harness's status footer off the bottom of its terminal screen.
 *
 * Statuslines are recognisable by their furniture: pipes between fields,
 * percentage figures, bar glyphs (█ ░ ▊), or Nerd Font icons. Prose almost
 * never carries any of them; status footers always do. Bottom-up, condensed,
 * capped by the caller.
 */
// A pipe with text either side, a percentage figure, or a run of bar
// glyphs. A lone glyph is not enough: grok closes every dialog row with a
// scrollbar cell, and those rows became the "status line".
const FURNITURE = /\S\s*\|\s*\S|\d+%|[█░▊▍▌▉▎▏]{3,}/;
// A status row can use middots instead of pipes. Two separators avoid
// mistaking an ordinary sentence containing one middot for a footer.
const MIDDOTS = /(?:·[^·]*){2,}/;

/** A full-width prompt edge. */
const RULE = /^[\s─═━╌┄┈╭╮╰╯┌┐└┘├┤┬┴┼│┃▔▁_]+$/;

/**
 * OMP mounts extension widgets directly below this editor edge. Widget rows
 * are ordinary Text components, so the TUI may wrap them at any word; a
 * continuation has no reliable glyph or wording of its own.
 */
const OMP_EDITOR_BOTTOM = /^╰─+\s+─+╯$/;

/**
 * Nerd Font icons, in both private-use areas.
 *
 * A statusline that separates its fields with `·` and labels them with icons
 * — no pipes, no percentages, no bar glyphs — matched none of the furniture
 * above and was dropped. That is the shape of a custom Claude Code
 * statusline's top row: model, directory, branch, commit. Every one of those
 * facts went missing while the bars below it came through.
 *
 * Two or more, because a private-use glyph is exactly the thing prose never
 * contains, but one could plausibly be a stray in tool output.
 */
const ICONS = /[\ue000-\uf8ff\u{f0000}-\u{ffffd}]/gu;

function isFurniture(line: string): boolean {
	if (FURNITURE.test(line) || MIDDOTS.test(line)) return true;
	return (line.match(ICONS)?.length ?? 0) >= 2;
}

export function extractStatusLines(visible: string, max = 6): string[] {
	const lines = visible.split('\n').filter((line) => line.trim() !== '');
	const floor = Math.max(0, lines.length - 48);
	let boundary = -1;
	let ompWidget = false;
	for (let i = lines.length - 1; i >= floor; i--) {
		if (RULE.test(lines[i])) {
			boundary = i;
			ompWidget = OMP_EDITOR_BOTTOM.test(lines[i]);
			break;
		}
	}

	const candidates = lines.slice(boundary >= floor ? boundary + 1 : floor);
	const hasFooter = boundary >= floor && candidates.some((line) => isFurniture(line.trim()));
	const found: string[] = [];
	for (const line of candidates.reverse()) {
		const trimmed = line.trim().replace(/\s{2,}/g, '  ');
		// Once one strong row confirms an OMP below-editor widget, every
		// non-chrome row in that region belongs to the widget or hook status.
		const widgetRow = ompWidget && hasFooter;
		if ((isFurniture(trimmed) || widgetRow) && !/^[-─═╰╭│┃┆┊┋┌└├┤╮╯]/.test(trimmed)) {
			found.unshift(trimmed);
			if (found.length === max) break;
		}
	}
	return found;
}
