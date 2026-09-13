/**
 * A herdr tab's name, without the animation herdr draws in front of it.
 *
 * `tab.list` returns the label exactly as the tab strip paints it, which means
 * it carries whatever marker the harness was showing at that instant:
 *
 *   "◑ Bordr exploration"
 *   "π > Assess bordr functionality with omp"
 *   "π ⠹ Compare Windows OMP Setup"
 *   "ci and reviews"                        ← plenty have none
 *
 * Those leading glyphs are a spinner frame, sampled once. herdr animates them;
 * bordr would show a single frozen frame next to its own status mark, which
 * reads as a live spinner on a pane that is doing nothing. So the name is kept
 * and the frame is dropped — the status is already shown, properly, by
 * `StatusMark`.
 */

/**
 * Leading characters that are decoration rather than name.
 *
 * Deliberately a list of shapes, never letters or digits: a tab called
 * "ctxc" or "Matt H PC Alert" must come through untouched, and the only way
 * to promise that is to strip nothing that could begin a real word.
 *
 *   U+25CB-U+25D7  circles and the half-filled spinner frames herdr uses
 *   U+2800-U+28FF  braille, the other common spinner set
 *   U+03C0         omp writes its own mark before the name
 *   >              and then its prompt arrow
 */
const DECORATION = /^[\s>π○-◗⠀-⣿]+/;

export function tabName(label: string): string {
	const stripped = label.replace(DECORATION, '').trim();
	// A tab whose whole name IS a glyph keeps it. Returning an empty string
	// would lose the only thing distinguishing it from every other tab.
	return stripped || label.trim();
}
