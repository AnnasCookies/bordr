/**
 * The curve the "Latest" button rides to the bottom of a transcript.
 *
 * An instant jump is right for following a live conversation — the page is
 * already at the end and you never see it move. It is wrong for a deliberate
 * "take me to the end" from a thousand lines up, where the screen simply
 * becomes somewhere else and nothing tells you how far you travelled.
 *
 * So it accelerates: barely moving at first, so the eye keeps its place, then
 * away rapidly. Cubic ease-IN rather than the browser's own `smooth`, which
 * is ease-in-OUT and spends its last third slowing down — a deceleration into
 * a destination you already asked for, which just reads as sluggish.
 */

/** Cubic ease-in: 0 at the start, 1 at the end, slow then fast. */
export function easeIn(t: number): number {
	const clamped = Math.min(1, Math.max(0, t));
	return clamped * clamped * clamped;
}

/**
 * How long the glide should take for a given distance.
 *
 * Not a fixed duration: the same 400ms is a crawl across 300px and a blur
 * across 20,000. Proportional to the distance and then capped, so a short hop
 * is quick and a long one never outstays its welcome.
 */
export const MIN_MS = 180;
export const MAX_MS = 520;

export function glideDuration(distance: number): number {
	const px = Math.abs(distance);
	return Math.min(MAX_MS, Math.max(MIN_MS, px * 0.35));
}

/**
 * Where the scroll should be, `elapsed` into a glide.
 *
 * `to` is read fresh each frame by the caller rather than captured: a live
 * transcript grows while this is running, and a glide that aims at where the
 * bottom WAS finishes short of where it now is.
 */
export function glidePosition(from: number, to: number, elapsed: number, duration: number): number {
	if (duration <= 0) return to;
	return from + (to - from) * easeIn(elapsed / duration);
}
