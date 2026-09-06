export interface PickerOption {
	index: number;
	label: string;
	selected: boolean;
	/** Multi-select checkbox state; undefined on single-select pickers. */
	checked?: boolean;
}

export interface Picker {
	question: string | null;
	options: PickerOption[];
	/** True for checkbox pickers: digits toggle, Enter submits. */
	multi: boolean;
	/** False for caret-only lists (Claude Code's trust prompt): no digit shortcuts, arrows and Enter. */
	numbered: boolean;
	/** 'text': no dialog exists; the option is typed back as a prompt (codex). Default 'keys'. */
	answer?: 'keys' | 'text';
	/** A slider: the stops sit side by side and ←/→ move between them (Claude Code's /effort). */
	axis?: 'horizontal';
}

/**
 * A question asked through a tool, still unanswered: the newest `ask` with
 * no user message after it. codex prints such a question as bullets in its
 * transcript and polls for typed input, so there is no dialog on screen.
 */
export function pendingAsk(
	messages: Array<{ role: string; ask?: { question: string; options: string[] } }>
): Picker | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === 'user') return null;
		if (message.ask && message.ask.options.length > 0) {
			return {
				question: message.ask.question,
				options: message.ask.options.map((label, n) => ({
					index: n + 1,
					label,
					selected: n === 0
				})),
				multi: false,
				numbered: false,
				answer: 'text'
			};
		}
	}
	return null;
}

/**
 * Option rows across harness dialects:
 *   Claude `❯ 1. Red`   codex `› 1. Yes`   agy `> 1. Much better`
 *   grok   `1 (○) Upgrade` — radio marker, no dot after the number
 * Selection is a caret (❯›>) or a filled radio (●◉).
 */
// A leading box border (grok draws its dialog inside ┃ … ┃) must not stop
// the row matching, so allow box-drawing/pipe glyphs before the marker.
const OPTION = /^[\s┃│┆┊┋|]*([❯›>])?\s*(\d+)(?:\.|\s*\(([●◉○])\))\s+(.+?)\s*$/;
// Footers, one per dialect: Claude "Enter to select · Esc to cancel", codex
// "Press enter to continue", agy "esc Skip", grok "Enter:submit", pi
// "Enter to select · Escape/Ctrl+C to cancel", omp "Enter select · n note ·
// ↑/↓ move · Esc cancel".
// Case-insensitive: agy writes "enter Select … esc Go Back".
const FOOTER =
	/\benter\b(?: to)?[ :](select|confirm|submit)|\besc(?:ape)?\b(?:\/ctrl\+c)?(?: to)? (?:cancel|go back)|press enter to|esc skip|↑\/↓ (?:to )?(?:navigate|move)/i;
/**
 * A footer that also says how to choose. agy's footer while it generates is
 * a bare "esc to cancel", and its echo of the prompt is a `>` row with the
 * wrapped remainder aligned beneath it — the exact shape of an unnumbered
 * list. Every real dialog footer names Enter, select, submit or the arrows.
 */
const CHOOSING_FOOTER = /\benter\b|\bselect\b|\bsubmit\b|\bconfirm\b|↑\/↓/i;
/** agy's model menu carries an effort slider aligned like an option row. */
const SLIDER_ROW = /[━●◉]{3,}|◂[\s\S]*▸/;
/** Multi-select rows carry a checkbox: `2. [x] Ding` (Claude uses ✔). */
const CHECKBOX = /^\[([ xX✓✔●■])\]\s+(.*)$/;
/**
 * An unnumbered highlighted row: `❯ No, exit` (Claude Code), `→ ✓ gpt-5.6-sol`
 * (pi's model selector, where ✓ marks the current one). The prefix, marker
 * included, is the label column its siblings align to.
 */
const CARET_ROW = /^([\s┃│┆┊┋|]*[❯›>→]\s+(?:[✓✔●○◉]\s+)?)(\S.*?)\s*$/;
/** A boxed dialog pads every row to its width and closes it with a border glyph. */
function bareLabel(label: string): string {
	const trimmed = label.replace(/\s*[┃│┆┊┋|█]+\s*$/, '').trim();
	// grok renders "label  description" and often makes them the same word.
	const halves = trimmed.split(/\s{2,}/);
	return halves.length === 2 && halves[0] === halves[1] ? halves[0] : trimmed;
}
/** What may sit before a sibling's label: box border, blanks, an unselected radio. */
const SIBLING_PREFIX = /^[\s┃│┆┊┋|]*(?:[✓✔●○◉]\s+)?\s*$/;
/**
 * An unnumbered option is a short label. A prompt echoed under a `>` (agy,
 * and any harness that wraps the remainder to the label column) is the
 * same shape as a two-row list, but its first row runs the whole width of
 * the terminal; no dialog's option does.
 */
const MAX_UNNUMBERED_LABEL = 100;
/**
 * A dialog's options sit right above its footer: a blank, a Submit row, a
 * box edge at most. A numbered list further away is the agent's prose,
 * which used to win over an unnumbered menu drawn beneath it — agy's model
 * menu after a reply that listed "1. Merged to main … 2. Main checkout
 * updated …" came back as those four sentences (seen live 2026-09-07).
 */
const MAX_FOOTER_GAP = 8;

/**
 * Parse a blocked agent's picker from a visible-screen capture.
 *
 * Must be given `agent.read --source visible` output. The detection region
 * (`after_last_horizontal_rule`) truncates mid-picker and is not usable here —
 * see spec §7a.
 */
export function parsePicker(visible: string): Picker | null {
	const lines = visible.split('\n');
	const options: PickerOption[] = [];
	let firstOptionLine = -1;
	let lastOptionLine = -1;
	let sawFooter = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (FOOTER.test(line)) {
			if (options.length > 0 && i - lastOptionLine <= MAX_FOOTER_GAP) {
				sawFooter = true;
				break;
			}
			// Prose, not a dialog: forget it and keep looking below.
			options.length = 0;
			firstOptionLine = -1;
			continue;
		}

		const match = OPTION.exec(line);
		if (!match) continue;

		const index = Number(match[2]);
		// Options number upward from 1, so a repeat or a step backwards means a
		// second list has begun. That happens when the agent's prose above the
		// dialog is itself a numbered list: collected together, the prose wins
		// and a tap answers the wrong option — on a permission prompt, the
		// wrong permission. Only the group nearest the footer is the picker.
		if (options.length > 0 && index === 1) {
			options.length = 0;
			firstOptionLine = -1;
		} else if (options.some((o) => o.index === index)) {
			continue; // a description line can repeat a label but never re-numbers
		}

		if (firstOptionLine === -1) firstOptionLine = i;
		lastOptionLine = i;
		const radio = match[3];
		const label = bareLabel(match[4]);
		const box = CHECKBOX.exec(label);
		options.push({
			index,
			label: box ? box[2] : label,
			// A caret marks the highlight; a filled radio marks it too.
			selected: match[1] !== undefined || radio === '●' || radio === '◉',
			...(box ? { checked: box[1] !== ' ' } : {})
		});
	}

	// The footer is what distinguishes a live picker from an ordinary
	// numbered list in agent prose.
	if (options.length === 0 || !sawFooter) return parseSlider(lines) ?? parseUnnumbered(lines);

	return {
		question: findQuestion(lines, firstOptionLine),
		options,
		multi: options.some((o) => o.checked !== undefined),
		numbered: true
	};
}

/** Claude Code's /effort footer; the only dialog so far that adjusts sideways. */
const SLIDER_FOOTER = /←\/→ to adjust/;
/** The marker on the track above the stops, under the current one. */
const SLIDER_MARKER = /[▲▴◆●◉]/;

/**
 * Claude Code's effort dialog (2.1.263) is a track with a marker under the
 * current stop and the stops named on the row beneath, three or more of
 * them set apart by runs of spaces:
 *
 *     ──────────────────────────────▲────────────┆──────────────────
 *     low     medium     high     xhigh      max       ultracode
 *     ←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel
 *
 * The stops become the options and the marker's column picks the current
 * one. Answered with ←/→ and Enter rather than digits or ↑/↓.
 */
function parseSlider(lines: string[]): Picker | null {
	const footerAt = lines.findIndex((line) => SLIDER_FOOTER.test(line));
	if (footerAt <= 1) return null;
	for (let i = footerAt - 1; i >= Math.max(1, footerAt - 6); i--) {
		const stops = [...lines[i].matchAll(/\S+/g)];
		if (stops.length < 3 || stops.length > 12) continue;
		if (stops.some((m) => m[0].length > 14)) continue;
		// Set apart in columns, not words in a sentence (the "xhigh + workflows"
		// caption under the last stop is words).
		const columns = stops.every(
			(m, n) => n === 0 || m.index - (stops[n - 1].index + stops[n - 1][0].length) >= 3
		);
		if (!columns) continue;
		const markerAt = lines[i - 1].search(SLIDER_MARKER);
		if (markerAt < 0) continue;
		let selected = 0;
		let nearest = Infinity;
		stops.forEach((m, n) => {
			const start = m.index;
			const end = start + m[0].length;
			const distance =
				markerAt < start ? start - markerAt : markerAt >= end ? markerAt - end + 1 : 0;
			if (distance < nearest) {
				nearest = distance;
				selected = n;
			}
		});
		return {
			question: sliderTitle(lines, i),
			options: stops.map((m, n) => ({ index: n + 1, label: m[0], selected: n === selected })),
			multi: false,
			numbered: false,
			axis: 'horizontal'
		};
	}
	return null;
}

/** The dialog's title: the nearest plain line above, skipping the track and its "Faster … Smarter" legend. */
function sliderTitle(lines: string[], stopsLine: number): string | null {
	for (let i = stopsLine - 1; i >= 0 && i >= stopsLine - 6; i--) {
		const text = lines[i].trim();
		if (!text || /\s{3,}/.test(text) || !/^[A-Za-z][\w ]{0,39}$/.test(text)) continue;
		return text;
	}
	return null;
}

/**
 * Claude Code's folder trust prompt (and newer dialogs like it) number
 * nothing: a caret marks the highlight and the other rows are indented to
 * the same column. Accepted only in the strictest shape, because without
 * numbers almost any indented block could pass: a footer, immediately above
 * it a contiguous block, exactly one caret row, every other row starting in
 * the caret row's label column, and at least two rows in all.
 */
function parseUnnumbered(lines: string[]): Picker | null {
	const footerAt = lines.findIndex((line) => FOOTER.test(line) && CHOOSING_FOOTER.test(line));
	if (footerAt <= 0) return null;

	// Anchor on a highlighted row above the footer, nearest first. A caret
	// row with no aligned siblings is not the list (copilot's model menu has
	// a "❯ Search models…" box between the rows and the footer), so keep
	// looking upward past it, within the dialog's reach.
	for (let anchor = footerAt - 1; anchor >= 0 && anchor >= footerAt - 40; anchor--) {
		const caret = CARET_ROW.exec(lines[anchor]);
		if (!caret) continue;
		const picker = listAround(lines, anchor, caret[1].length, footerAt);
		if (picker) return picker;
	}
	return null;
}

function listAround(
	lines: string[],
	anchor: number,
	column: number,
	footerAt: number
): Picker | null {
	const aligned = (line: string) =>
		line.length > column && SIBLING_PREFIX.test(line.slice(0, column)) && /\S/.test(line[column]);
	const rowAt = (i: number) => {
		const caret = CARET_ROW.exec(lines[i]);
		if (caret && caret[1].length === column) {
			return { line: i, label: bareLabel(caret[2]), selected: true };
		}
		if (aligned(lines[i])) {
			return { line: i, label: bareLabel(lines[i].slice(column)), selected: false };
		}
		return null;
	};

	// Contiguous aligned rows around the anchor; the first line that is not
	// one (the question, a search box, a page counter) ends the list.
	const rows = [rowAt(anchor) as { line: number; label: string; selected: boolean }];
	for (let i = anchor - 1; i >= 0; i--) {
		const row = rowAt(i);
		if (!row) break;
		rows.unshift(row);
	}
	for (let i = anchor + 1; i < footerAt; i++) {
		const row = rowAt(i);
		if (!row) break;
		rows.push(row);
	}
	const options = rows.filter((r) => !SLIDER_ROW.test(r.label));
	if (options.length < 2 || options.filter((r) => r.selected).length !== 1) return null;
	if (options.some((r) => r.label.length > MAX_UNNUMBERED_LABEL)) return null;

	return {
		question: findQuestion(lines, options[0].line),
		options: options.map((r, n) => ({ index: n + 1, label: r.label, selected: r.selected })),
		multi: false,
		numbered: false
	};
}

/**
 * The question above the options: the nearest line that asks one, within a
 * few lines (Claude's dialogs put a "Security guide" link or tool details
 * between the question and the rows), else the nearest non-blank line.
 */
function findQuestion(lines: string[], firstOptionLine: number): string | null {
	let nearest: string | null = null;
	for (let i = firstOptionLine - 1; i >= 0 && i >= firstOptionLine - 8; i--) {
		const text = lines[i].trim();
		if (!text) continue;
		// The user's input line also starts with the caret — not a question.
		if (/^[❯›>]/.test(text)) break;
		// A boxed dialog's question carries the border glyph; the phone does not want it.
		const bare = text.replace(/^[┃│┆┊┋|]+\s*/, '').replace(/\s*[┃│┆┊┋|]+$/, '');
		if (nearest === null) nearest = bare;
		if (bare.includes('?')) return bare;
	}
	return nearest;
}

/**
 * Keys that select `index`.
 *
 * Single digits both select and confirm in one keystroke, which is absolute
 * rather than relative — no race against the current highlight (spec §7a).
 * Options past 9 have no digit shortcut, so fall back to relative arrows.
 */
export function keysForOption(
	index: number,
	currentlySelected?: number,
	numbered = true,
	axis?: Picker['axis']
): string[] {
	if (numbered && index >= 1 && index <= 9) return [String(index)];

	const from = currentlySelected ?? 1;
	const distance = index - from;
	const arrow =
		axis === 'horizontal' ? (distance >= 0 ? 'right' : 'left') : distance >= 0 ? 'down' : 'up';
	return [...Array(Math.abs(distance)).fill(arrow), 'enter'];
}

/** A bottom row that says how to leave and how to move: a panel or menu is open. */
const MENU_LEAVE = /\besc(?:ape)?\b/i;
const MENU_MOVE =
	/\b(?:enter|tab|space|navigate|select|close|cancel|exit|dismiss)\b|↑\/↓|←\/→|type to/i;

/**
 * A menu or panel is open on the terminal even though no option rows could
 * be read from it: omp's model browser, Claude Code's /config and /usage
 * panels. Their footers all say how to leave (Esc) alongside how to move or
 * choose, and no harness's idle footer says Esc at all (sampled across
 * claude, pi, omp, codex and agy, 2026-09-07). Returns that footer, tidied,
 * so the phone can say "a menu is open — drive it with the key strip".
 * Callers skip working panes: agy's generating footer is a bare "esc to
 * cancel".
 */
export function menuFooter(visible: string): string | null {
	const rows = visible.split('\n').filter((line) => line.trim() !== '');
	for (const row of rows.slice(-8).reverse()) {
		if (!MENU_LEAVE.test(row) || !MENU_MOVE.test(row)) continue;
		const tidy = row
			.replace(/^[\s┃│┆┊┋|]+/, '')
			.replace(/[\s┃│┆┊┋|]+$/, '')
			.replace(/\s{2,}/g, ' · ')
			.trim();
		return tidy.length > 140 ? `${tidy.slice(0, 139)}…` : tidy;
	}
	return null;
}
