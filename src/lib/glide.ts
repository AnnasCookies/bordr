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

/**
 * Ease-in, mostly cubic, with a little of the journey spent at a flat rate.
 *
 * Pure cubic was imperceptible at the start: over the 16,000px a phone
 * actually travels it covered 107px in the first 100ms — about a pixel a
 * frame, which is not "moving slowly", it is "not moving". The eye saw a
 * pause and then an arrival, and read the whole thing as an instant jump.
 *
 * The linear twelfth gives the start something to show while the cubic term
 * is still near zero, and is small enough that the end is still a rush.
 */
export function easeIn(t: number): number {
	const clamped = Math.min(1, Math.max(0, t));
	return 0.12 * clamped + 0.88 * clamped * clamped * clamped;
}

/**
 * How long the glide should take for a given distance.
 *
 * Not a fixed duration: the same 400ms is a crawl across 300px and a blur
 * across 20,000.
 *
 * Nor proportional, which is what this was. Multiplying by 0.35 and capping
 * at 520ms meant everything past ~1,500px got the SAME half second — and a
 * phone transcript is tens of thousands of pixels, so every real press landed
 * on the cap. Measured at 16,000px: 31 frames, the last of them moving
 * 1,504px, or nearly two screens between one frame and the next. There is no
 * motion to see at that rate, only a before and an after.
 *
 * By the square root instead, so the time still grows with the distance but a
 * journey twenty times longer takes four times as long rather than twenty:
 * a long haul stays quick without turning its final frames into a cut.
 */
export const MIN_MS = 260;
export const MAX_MS = 2000;

export function glideDuration(distance: number): number {
	const px = Math.abs(distance);
	return Math.min(MAX_MS, Math.max(MIN_MS, Math.sqrt(px) * 10));
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
