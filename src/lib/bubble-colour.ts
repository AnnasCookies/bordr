import { contrastRatio, parseHex, readableTextOn } from './contrast';

/**
 * Colour maths for a filled bubble.
 *
 * One module because the two halves have to agree: the component paints the
 * fill, the callers pick the text that goes on it. Computed apart, the text
 * was chosen against the fill's base colour while the fade ran somewhere
 * else entirely, and the top of a bubble came out at 2.1:1.
 */

/**
 * The default colours a bubble falls back to when nothing is picked.
 *
 * Here rather than inline at each use: these were written out as literals in
 * four files, and the light agent fill was `#eceef1` — 1.07 against the page,
 * which is no contrast at all. A light-mode agent bubble simply could not be
 * seen. Darkened until it reads as a shape.
 */
export const DEFAULT_FILL = { light: '#dfe4ea', dark: '#262626' } as const;
export const DEFAULT_USER = { light: '#3558e6', dark: '#2f4fd0' } as const;
export const DEFAULT_INK = { light: '#111418', dark: '#e5e5e5' } as const;
export const PAGE = { light: '#f4f5f7', dark: '#0a0a0a' } as const;

/** A fill below this against the page does not read as a bubble at all. */
export const FILL_VISIBLE = 1.15;

/**
 * How much of the fill survives at the far end of a fade.
 *
 * Only a look decision, not a legibility one — see `fillFar` for why the
 * fade cannot hurt the text whatever this is set to. Low enough to see,
 * high enough to stay subtle.
 */
export const FILL_FADE = 0.78;

/** Blend two hex colours. `pct` is how much of `a` survives. */
export function mixHex(a: string, b: string, pct: number): string {
	const x = parseHex(a);
	const y = parseHex(b);
	if (!x || !y) return a;
	const channel = (i: number) => Math.round(x[i] * pct + y[i] * (1 - pct));
	return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Where a faded fill ends up.
 *
 * It fades AWAY from its own text colour — darker under white text, lighter
 * under black — never towards the page. Fading towards the page was the
 * first attempt and it is unfixable by tuning: on a dark theme the fill
 * darkens under black text, on a light theme it lightens under white, so
 * whichever direction the page lies in, the contrast falls. claude's orange
 * reached 2.10:1 that way and omp's violet 4.08:1.
 *
 * Going the other way means the far end is always further from the ink than
 * the base is, so a fill that reads flat reads faded — by construction, with
 * no number to keep tuning.
 */
export function fillFar(fill: string): string {
	if (!parseHex(fill)) return fill;
	return mixHex(fill, readableTextOn(fill) === '#000000' ? '#ffffff' : '#000000', FILL_FADE);
}

/**
 * Text that reads across the whole of a fill.
 *
 * Because `fillFar` moves away from this colour, checking the base is enough
 * — but both ends are measured anyway, so that a future change to the fade
 * cannot quietly break the text without the test noticing.
 */
export function bubbleInk(
	fill: string,
	dark: boolean,
	gradient: boolean,
	/** Where the gradient actually ends, when it is not the derived one. */
	end?: string | null
): string {
	if (!parseHex(fill)) return dark ? DEFAULT_INK.dark : DEFAULT_INK.light;
	const far = end && parseHex(end) ? end : fillFar(fill);
	const ends = gradient ? [fill, far] : [fill];
	const worst = (ink: string) => Math.min(...ends.map((e) => contrastRatio(ink, e)));
	return worst('#000000') >= worst('#ffffff') ? '#000000' : '#ffffff';
}

/**
 * The worst contrast the chosen text gets anywhere across a fill.
 *
 * A picked gradient end is the operator's call, not something this can solve —
 * a pale fill fading into a dark harness colour has no single readable ink. So
 * settings measures it and says so rather than silently producing a bubble
 * half of which cannot be read.
 */
export function fillWorstContrast(
	fill: string,
	dark: boolean,
	gradient: boolean,
	end?: string | null
): number {
	if (!parseHex(fill)) return 21;
	const ink = bubbleInk(fill, dark, gradient, end);
	const far = end && parseHex(end) ? end : fillFar(fill);
	const ends = gradient ? [fill, far] : [fill];
	return Math.min(...ends.map((e) => contrastRatio(ink, e)));
}
