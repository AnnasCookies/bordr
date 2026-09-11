/**
 * The harness's own activity line, lifted off the screen.
 *
 * What a terminal shows while an agent works — its verb, how long it has
 * been going, tokens spent — and the tip underneath it. None of this reaches
 * the transcript: it is painted and repainted in place, so the screen is the
 * only source.
 *
 * Two shapes, both measured live on Claude Code:
 *   working  `✢ Channeling… (4m 36s · ↓ 6.5k tokens)`
 *   finished `✻ Sautéed for 5m 8s · done 12:43 AM`
 * pi, omp and codex draw their own verbs against the same glyph set.
 */
export interface Activity {
	/** The verb and its parenthetical, e.g. "Channeling… (4m 36s · ↓ 6.5k tokens)". */
	text: string;
	/** The `⎿ Tip: …` line that sometimes follows, without its marker. */
	tip: string | null;
}

/** Braille and asterisk spinners every harness here draws with. */
const SPINNER = /^\s*([✻✳✢✽✶✷✸✹✺★✦✧∗*·◐◓◑◒])\s+(\S.*?)\s*$/;
const TIP = /^\s*⎿\s+(?:Tip:\s*)?(\S.*?)\s*$/;
/** A status bar row is furniture, not activity. */
const FURNITURE = /\|\s|\d+%|[█░▊▍▌▉▎▏▰▱]{3,}/;

export function extractActivity(visible: string): Activity | null {
	const lines = visible.split('\n');
	// Bottom-up: the live line is the last one drawn, and an old one may still
	// be sitting further up in the scrollback of the same screen.
	for (let i = lines.length - 1; i >= 0; i--) {
		const match = SPINNER.exec(lines[i]);
		if (!match) continue;
		const text = match[2].replace(/\s{2,}/g, ' ').trim();
		// A bare glyph, or a row that is really the status bar, is not activity.
		if (text.length < 3 || FURNITURE.test(text)) continue;
		const next = lines[i + 1] ?? '';
		const tip = TIP.exec(next)?.[1] ?? null;
		return { text, tip: tip && tip.length > 2 ? tip : null };
	}
	return null;
}
