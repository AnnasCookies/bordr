/**
 * Minimal SGR-to-HTML renderer for terminal snapshots.
 *
 * Deliberately a LOG renderer, not a screen emulator: it understands colour
 * and weight and discards every other control sequence. Agent TUIs use
 * colour semantically (diff green/red, warning amber), and stripping it
 * loses meaning the text alone does not carry.
 */

const ESC = String.fromCharCode(27);
// CSI ... final-byte. Only `m` (SGR) is rendered; the rest are dropped.
const CSI = new RegExp(`${ESC}\\[([0-9;]*)([A-Za-z])`, 'g');
const OSC = new RegExp(`${ESC}\\][^${ESC}\\u0007]*(?:\\u0007|${ESC}\\\\)`, 'g');

const BASE = [
	'#1e1e1e',
	'#f87171',
	'#4ade80',
	'#fbbf24',
	'#60a5fa',
	'#c084fc',
	'#22d3ee',
	'#d4d4d4'
];
const BRIGHT = [
	'#6b7280',
	'#fca5a5',
	'#86efac',
	'#fde047',
	'#93c5fd',
	'#d8b4fe',
	'#67e8f9',
	'#ffffff'
];

interface Style {
	fg?: string;
	bg?: string;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
}

/**
 * Characters a terminal draws two columns wide: CJK, and the emoji blocks.
 * Everything else outside ASCII is one column.
 */
function isWide(code: number): boolean {
	return (
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe30 && code <= 0xfe6f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x1f300 && code <= 0x1faff)
	);
}

/**
 * Pin every non-ASCII character to its terminal cell width.
 *
 * A TUI draws rulers and markers with box-drawing characters, and no font in
 * the stack covers them — so the browser falls back per glyph to a font with a
 * different advance. Measured in this app: `─` and `▲` render at 0.943x the
 * ASCII advance and `✶` at 1.886x, which over a 120-column ruler drifts the
 * marker about seven cells away from the labels underneath it. That is the
 * /effort slider pointing at nothing.
 *
 * ASCII always comes from the primary monospace font and is left alone, so
 * ordinary output costs nothing.
 */
function cells(text: string): string {
	let out = '';
	let plain = '';
	for (const ch of text) {
		const code = ch.codePointAt(0) as number;
		if (code < 0x80) {
			plain += ch;
			continue;
		}
		if (plain) {
			out += esc(plain);
			plain = '';
		}
		out += `<span class="${isWide(code) ? 'tc tc-w' : 'tc'}">${esc(ch)}</span>`;
	}
	return out + esc(plain);
}

const HTML: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;'
};
function esc(value: string): string {
	return value.replace(/[&<>"']/g, (c) => HTML[c]);
}

function apply(style: Style, codes: number[]): Style {
	let next = { ...style };
	for (let i = 0; i < codes.length; i++) {
		const c = codes[i];
		if (c === 0) next = {};
		else if (c === 1) next.bold = true;
		else if (c === 2) next.dim = true;
		else if (c === 3) next.italic = true;
		else if (c === 4) next.underline = true;
		else if (c === 22) {
			next.bold = false;
			next.dim = false;
		} else if (c === 23) next.italic = false;
		else if (c === 24) next.underline = false;
		else if (c >= 30 && c <= 37) next.fg = BASE[c - 30];
		else if (c >= 90 && c <= 97) next.fg = BRIGHT[c - 90];
		else if (c >= 40 && c <= 47) next.bg = BASE[c - 40];
		else if (c >= 100 && c <= 107) next.bg = BRIGHT[c - 100];
		else if (c === 39) next.fg = undefined;
		else if (c === 49) next.bg = undefined;
		else if (c === 38 || c === 48) {
			// Extended colour: 5;n (256) or 2;r;g;b (truecolor)
			const target = c === 38 ? 'fg' : 'bg';
			if (codes[i + 1] === 5) {
				next[target] = xterm256(codes[i + 2]);
				i += 2;
			} else if (codes[i + 1] === 2) {
				next[target] = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`;
				i += 4;
			}
		}
	}
	return next;
}

function xterm256(n: number): string {
	if (n < 8) return BASE[n];
	if (n < 16) return BRIGHT[n - 8];
	if (n < 232) {
		const i = n - 16;
		const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
		return `rgb(${level(Math.floor(i / 36))},${level(Math.floor(i / 6) % 6)},${level(i % 6)})`;
	}
	const grey = 8 + (n - 232) * 10;
	return `rgb(${grey},${grey},${grey})`;
}

function css(style: Style): string {
	const parts: string[] = [];
	if (style.fg) parts.push(`color:${style.fg}`);
	if (style.bg) parts.push(`background:${style.bg}`);
	if (style.bold) parts.push('font-weight:600');
	if (style.dim) parts.push('opacity:.65');
	if (style.italic) parts.push('font-style:italic');
	if (style.underline) parts.push('text-decoration:underline');
	return parts.join(';');
}

/**
 * Render ANSI-coloured text to HTML. Input is escaped; output is safe.
 *
 * `gridded` pins non-ASCII glyphs to their terminal cell width — correct for a
 * screen snapshot, unnecessary for prose.
 */
export function ansiToHtml(input: string, gridded = false): string {
	const render = gridded ? cells : esc;
	const text = input.replace(OSC, '');
	let style: Style = {};
	let out = '';
	let last = 0;
	CSI.lastIndex = 0;

	for (let m = CSI.exec(text); m !== null; m = CSI.exec(text)) {
		const chunk = text.slice(last, m.index);
		if (chunk) {
			const s = css(style);
			out += s ? `<span style="${s}">${render(chunk)}</span>` : render(chunk);
		}
		if (m[2] === 'm') {
			const codes = m[1] === '' ? [0] : m[1].split(';').map((n) => Number(n) || 0);
			style = apply(style, codes);
		}
		last = m.index + m[0].length;
	}

	const tail = text.slice(last);
	if (tail) {
		const s = css(style);
		out += s ? `<span style="${s}">${render(tail)}</span>` : render(tail);
	}
	return out;
}

/**
 * Drop every escape sequence, leaving the characters a terminal would show.
 *
 * Used to line an ANSI screen read up against herdr's own plain-text
 * rendering of the same screen, so a line can be found by its content and
 * then rendered with its colour.
 */
export function stripAnsi(input: string): string {
	return input.replace(CSI, '').replace(OSC, '');
}

/** Widest row in terminal cells, after colour and control sequences are removed. */
export function terminalScreenColumns(input: string): number {
	let widest = 0;
	for (const line of stripAnsi(input).split('\n')) {
		let columns = 0;
		for (const character of line) {
			const code = character.codePointAt(0) as number;
			// Combining marks occupy the previous cell rather than another one.
			if ((code >= 0x300 && code <= 0x36f) || (code >= 0xfe00 && code <= 0xfe0f)) continue;
			columns += isWide(code) ? 2 : 1;
		}
		widest = Math.max(widest, columns);
	}
	return widest;
}
