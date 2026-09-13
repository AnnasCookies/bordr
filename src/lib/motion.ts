/**
 * What the browser says about motion.
 *
 * The default answer for the Motion setting, and shown in Settings next to it
 * — because when the browser gets this wrong there is otherwise nothing on the
 * page to tell you why an animation you can see elsewhere never runs here. The
 * browser reads the setting through a desktop portal, and a machine whose
 * animations are plainly on can still report `reduce`.
 */
export function reduceMotion(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
