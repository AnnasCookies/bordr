/**
 * Lift a harness's status footer off the bottom of its terminal screen.
 *
 * Statuslines are recognisable by their furniture: pipes between fields,
 * percentage figures, or bar glyphs (█ ░ ▊). Prose almost never combines
 * them; status footers always do. Up to three lines, bottom-up, condensed.
 */
// A pipe with text either side, a percentage figure, or a run of bar
// glyphs. A lone glyph is not enough: grok closes every dialog row with a
// scrollbar cell, and those rows became the "status line".
const FURNITURE = /\S\s*\|\s*\S|\d+%|[█░▊▍▌▉▎▏]{3,}/;

export function extractStatusLines(visible: string, max = 6): string[] {
	const lines = visible.split('\n').filter((l) => l.trim() !== '');
	const found: string[] = [];
	// No contiguity requirement: pi splits its dashboard from its bottom
	// ruler with a prompt line, and a gap rule stranded everything above
	// it. The 12-line window and the cap bound the scrape instead.
	for (const line of lines.slice(-12).reverse()) {
		const trimmed = line.trim().replace(/\s{2,}/g, '  ');
		if (FURNITURE.test(trimmed) && !/^[─═╰╭│┃┆┊┋┌└├┤╮╯]/.test(trimmed)) {
			found.unshift(trimmed);
			if (found.length === max) break;
		}
	}
	return found;
}
