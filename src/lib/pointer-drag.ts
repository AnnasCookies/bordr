/**
 * Follow one pointer from pointerdown until it lets go.
 *
 * Two drag handles need this, and the second one written — the desktop
 * sidebar's edge — repeated every mistake the first had already been fixed
 * for. One copy cannot drift from itself.
 *
 * Listeners on the handle, not the window: pointer capture routes the whole
 * drag to the handle, and a listener that lives on its element cannot keep
 * reacting to movement elsewhere on the page once the gesture is over.
 *
 * `pointercancel` as well as `pointerup`: cancel is what fires when the
 * browser takes a touch over for a scroll, and a drag that only ended on
 * `pointerup` never ended at all then, so every later movement kept resizing.
 *
 * `touch-action: none` stays the handle's own job, in CSS. The browser
 * decides whether a touch scrolls before any listener runs, so nothing here
 * can claim the gesture for it.
 */

/** Just the part of an element this uses, so it can be tested without a DOM. */
export type DragHandle = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
	setPointerCapture(pointerId: number): void;
};

export interface PointerAt {
	clientX: number;
	clientY: number;
}

/** A pointer event's position and id, or null for anything that is not one. */
function pointerOf(event: Event): (PointerAt & { pointerId: number }) | null {
	if (!('pointerId' in event) || !('clientX' in event) || !('clientY' in event)) return null;
	const { pointerId, clientX, clientY } = event;
	if (typeof pointerId !== 'number' || typeof clientX !== 'number' || typeof clientY !== 'number') {
		return null;
	}
	return { pointerId, clientX, clientY };
}

export function followPointer(
	handle: DragHandle,
	pointerId: number,
	on: { move: (at: PointerAt) => void; end: () => void }
): void {
	// Only the pointer that started the drag: a second finger landing on the
	// handle must neither steer it nor end it by lifting.
	const mine = (event: Event) => {
		const pointer = pointerOf(event);
		return pointer && pointer.pointerId === pointerId ? pointer : null;
	};
	const move = (event: Event) => {
		const pointer = mine(event);
		if (pointer) on.move(pointer);
	};
	const stop = (event: Event) => {
		if (!mine(event)) return;
		handle.removeEventListener('pointermove', move);
		handle.removeEventListener('pointerup', stop);
		handle.removeEventListener('pointercancel', stop);
		on.end();
	};

	handle.setPointerCapture(pointerId);
	handle.addEventListener('pointermove', move);
	handle.addEventListener('pointerup', stop);
	handle.addEventListener('pointercancel', stop);
}
