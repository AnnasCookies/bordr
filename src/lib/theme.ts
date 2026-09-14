import { parseHex } from './contrast';

/** One accent per harness, used anywhere an agent is named or quoted.
 *  Full literal class strings — Tailwind cannot see composed names. */
export const HARNESS_TEXT: Record<string, string> = {
	claude: 'text-orange-600 dark:text-orange-400',
	codex: 'text-teal-600 dark:text-teal-400',
	omp: 'text-violet-600 dark:text-violet-400',
	pi: 'text-sky-600 dark:text-sky-400',
	grok: 'text-rose-600 dark:text-rose-400',
	gemini: 'text-emerald-600 dark:text-emerald-400',
	agy: 'text-lime-600 dark:text-lime-400'
};

export const HARNESS_BORDER: Record<string, string> = {
	claude: 'border-orange-600/50 dark:border-orange-400/50',
	codex: 'border-teal-600/50 dark:border-teal-400/50',
	omp: 'border-violet-600/50 dark:border-violet-400/50',
	pi: 'border-sky-600/50 dark:border-sky-400/50',
	grok: 'border-rose-600/50 dark:border-rose-400/50',
	gemini: 'border-emerald-600/50 dark:border-emerald-400/50',
	agy: 'border-lime-600/50 dark:border-lime-400/50'
};

/** Raw hex, for the places that need a colour value rather than a class:
 *  inline `style` on a status rail, an SVG fill, a chip border. */
export const HARNESS_HEX: Record<string, { light: string; dark: string }> = {
	claude: { light: '#ea580c', dark: '#fb923c' },
	codex: { light: '#0d9488', dark: '#2dd4bf' },
	omp: { light: '#7c3aed', dark: '#a78bfa' },
	pi: { light: '#0284c7', dark: '#38bdf8' },
	grok: { light: '#e11d48', dark: '#fb7185' },
	gemini: { light: '#059669', dark: '#34d399' },
	agy: { light: '#65a30d', dark: '#a3e635' }
};

export function harnessText(agent: string): string {
	return HARNESS_TEXT[agent] ?? 'text-muted';
}

export function harnessBorder(agent: string): string {
	return HARNESS_BORDER[agent] ?? 'border-edge';
}

export function harnessHex(agent: string, dark: boolean): string {
	const pair = HARNESS_HEX[agent];
	if (!pair) return dark ? '#a3a3a3' : '#6b7280';
	return dark ? pair.dark : pair.light;
}

/** Status rail fill. `unknown` is a dashed rail, so it has no solid class. */
export const STATUS_RAIL: Record<string, string> = {
	blocked: 'bg-blocked',
	working: 'bg-working',
	done: 'bg-done',
	idle: 'bg-idle-rail'
};

/** The status word beside a row title. */
export const STATUS_INK: Record<string, string> = {
	blocked: 'text-blocked-ink',
	working: 'text-working',
	done: 'text-done',
	idle: 'text-faint',
	unknown: 'text-faint'
};

/**
 * A glyph per status, for the sidebar's `symbol` indicator mode.
 *
 * herdr's own set, so the two read the same way side by side — a tick for
 * work that finished, a hollow ring for ready, a half-filled ring for
 * something in progress, a cross for something stopped and waiting on you,
 * and a dot for a pane with no agent in it at all.
 *
 * They also differ by SHAPE, not only colour, so the list still scans for
 * anyone who does not separate red from green.
 */
export const STATUS_SYMBOL: Record<string, string> = {
	blocked: '✕',
	working: '◑',
	done: '✓',
	idle: '○',
	unknown: '·'
};

/** The same, spelled out, for the `text` mode. */
export const STATUS_WORD: Record<string, string> = {
	blocked: 'blocked',
	working: 'working',
	done: 'done',
	idle: 'idle',
	unknown: 'shell'
};

/**
 * A 4px dashed rail, drawn as a repeating gradient because a dashed border on
 * a 4px column renders as a solid line at this width.
 */
export const UNKNOWN_RAIL =
	'repeating-linear-gradient(0deg, var(--idle-rail) 0 4px, transparent 4px 8px)';

/**
 * The agent bubble, tinted with the harness's own accent.
 *
 * A full-strength accent is unreadable as a background, so the accent is
 * blended into the neutral bubble at a low ratio — enough that claude and
 * codex are told apart at a glance, not enough to fight the text on top.
 * Falls back to the neutral bubble for a harness with no accent.
 */
export function harnessBubble(agent: string, dark: boolean, neutral: string): string {
	const accent = HARNESS_HEX[agent];
	if (!accent) return neutral;
	const tint = parseHex(dark ? accent.dark : accent.light);
	const base = parseHex(neutral);
	if (!tint || !base) return neutral;
	// Lighter touch on dark, where a tint reads much more strongly.
	const ratio = dark ? 0.16 : 0.13;
	const mixed = base.map((channel, i) => Math.round(channel + (tint[i] - channel) * ratio));
	return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * One glyph per harness, from the Nerd Font subset bordr ships.
 *
 * Claude Code draws its own model line with 󰚩; the rest are chosen to be
 * distinguishable at 11px rather than to be logos, which do not exist as
 * glyphs. A harness with no entry gets the generic terminal mark, which is
 * also what a plain shell pane gets.
 */
const HARNESS_ICON: Record<string, string> = {
	claude: '\u{F06A9}', // robot
	codex: '\u{F0169}', // code-braces
	omp: '\u{F0335}', // lightning-bolt-circle
	pi: '\u{F03A1}', // math-compass
	grok: '\u{F0208}', // flash
	gemini: '\u{F0522}', // star-four-points
	agy: '\u{F0B0C}', // rocket
	copilot: '\u{F0A0F}' // account-supervisor
};

/** The generic pane mark: a terminal. */
export const SHELL_ICON = '\u{F018D}';

export function harnessIcon(agent: string): string {
	return HARNESS_ICON[agent] ?? SHELL_ICON;
}
