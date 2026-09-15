/**
 * How wide the desktop sidebar may be, and how any candidate width is made
 * safe.
 *
 * A plain module rather than a constant exported from the resizer: prefs has
 * to clamp what it reads out of storage, and the resizer imports prefs — so
 * keeping the bounds in the component would make the two import each other.
 */

export const MIN_SIDEBAR = 200;
export const MAX_SIDEBAR = 520;
export const DEFAULT_SIDEBAR = 276;

/** Whatever it came from — a drag, a key, or a stored value someone edited. */
export function clampSidebar(width: number): number {
	if (!Number.isFinite(width)) return DEFAULT_SIDEBAR;
	return Math.min(Math.max(Math.round(width), MIN_SIDEBAR), MAX_SIDEBAR);
}
