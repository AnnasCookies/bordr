export type SwipeDirection = 'next' | 'previous';

export interface SwipeLimits {
	/** Minimum horizontal travel before it counts as a swipe at all. */
	distance: number;
	/** Horizontal travel must beat vertical by this factor — reading a long
	 *  transcript is a vertical gesture and must never navigate. */
	ratio: number;
	/**
	 * Ignore gestures beginning this close to EITHER edge. Phones reserve both
	 * for the system back gesture, and racing it means the page navigates and
	 * goes back at once. Wide enough to clear a thumb landing near the bezel.
	 */
	edge: number;
}

export const SWIPE: SwipeLimits = { distance: 60, ratio: 2, edge: 32 };

/**
 * Which way a finished gesture went, or null when it was not a swipe.
 *
 * Right means "next agent down the list": the list order is what the reader
 * just came from, so moving forward through it is the natural direction.
 */
export function decideSwipe(
	dx: number,
	dy: number,
	startX: number,
	viewportWidth: number,
	limits: SwipeLimits = SWIPE
): SwipeDirection | null {
	// Both edges belong to the system back gesture, not to us.
	if (startX <= limits.edge) return null;
	if (startX >= viewportWidth - limits.edge) return null;
	if (Math.abs(dx) < limits.distance) return null;
	if (Math.abs(dx) < Math.abs(dy) * limits.ratio) return null;
	return dx > 0 ? 'next' : 'previous';
}

/**
 * The pane a swipe should land on, or null when there is nowhere to go.
 *
 * Wraps, because this is a cycle: the edges of the screen are now the way back
 * to the list, so running off the end of the order has no separate job to do
 * and stopping dead there would just feel like a broken swipe.
 */
export function neighbourPane(
	order: string[],
	current: string,
	direction: SwipeDirection
): string | null {
	if (order.length < 2) return null;
	const at = order.indexOf(current);
	if (at === -1) return null;
	const step = direction === 'next' ? 1 : -1;
	return order[(at + step + order.length) % order.length];
}

/**
 * True when the gesture began inside something that scrolls horizontally —
 * a tool block, the screen peek, a code fence. Those own the gesture.
 */
export function inHorizontalScroller(target: EventTarget | null, root: Element): boolean {
	let node = target instanceof Element ? target : null;
	while (node && node !== root) {
		if (node.scrollWidth > node.clientWidth + 1) {
			const overflow = getComputedStyle(node).overflowX;
			if (overflow === 'auto' || overflow === 'scroll') return true;
		}
		node = node.parentElement;
	}
	return false;
}
