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
 * A 4px dashed rail, drawn as a repeating gradient because a dashed border on
 * a 4px column renders as a solid line at this width.
 */
export const UNKNOWN_RAIL =
	'repeating-linear-gradient(0deg, var(--idle-rail) 0 4px, transparent 4px 8px)';
