import { describe, expect, it } from 'vitest';
import { followPointer } from './pointer-drag';

/** An element as far as a drag is concerned: events, and capture. */
class Handle extends EventTarget {
	captured: number | null = null;

	setPointerCapture(pointerId: number): void {
		this.captured = pointerId;
	}

	fire(type: string, pointerId: number, clientY = 0): void {
		this.dispatchEvent(Object.assign(new Event(type), { pointerId, clientX: 0, clientY }));
	}
}

function startDrag(handle: Handle, pointerId = 1) {
	const moves: number[] = [];
	let ends = 0;
	followPointer(handle, pointerId, {
		move: (at) => moves.push(at.clientY),
		end: () => ends++
	});
	return { moves, ends: () => ends };
}

describe('followPointer', () => {
	it('captures the pointer on the handle itself', () => {
		const handle = new Handle();
		startDrag(handle, 7);
		expect(handle.captured).toBe(7);
	});

	it('follows the pointer until it lifts, and not after', () => {
		const handle = new Handle();
		const drag = startDrag(handle);
		handle.fire('pointermove', 1, 100);
		handle.fire('pointermove', 1, 140);
		handle.fire('pointerup', 1);
		handle.fire('pointermove', 1, 600);
		expect(drag.moves).toEqual([100, 140]);
		expect(drag.ends()).toBe(1);
	});

	/**
	 * The haunted one. The browser cancels a touch it takes over for a scroll,
	 * and a drag that only ended on pointerup kept resizing on every later
	 * movement for the life of the page.
	 */
	it('stops listening when the browser cancels the gesture', () => {
		const handle = new Handle();
		const drag = startDrag(handle);
		handle.fire('pointercancel', 1);
		handle.fire('pointermove', 1, 700);
		expect(drag.moves).toEqual([]);
		expect(drag.ends()).toBe(1);
	});

	it('ends once, however many ways the pointer says so', () => {
		const handle = new Handle();
		const drag = startDrag(handle);
		handle.fire('pointercancel', 1);
		handle.fire('pointerup', 1);
		expect(drag.ends()).toBe(1);
	});

	it('ignores a second pointer, moving or lifting', () => {
		const handle = new Handle();
		const drag = startDrag(handle);
		handle.fire('pointermove', 2, 300);
		handle.fire('pointerup', 2);
		expect(drag.moves).toEqual([]);
		expect(drag.ends()).toBe(0);

		handle.fire('pointermove', 1, 320);
		handle.fire('pointerup', 1);
		expect(drag.moves).toEqual([320]);
		expect(drag.ends()).toBe(1);
	});
});
