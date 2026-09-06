/**
 * A leading-edge throttle that never drops the last call in a burst.
 *
 * A plain throttle discards everything inside the window, which lost the
 * "done" event that lands 200 ms after the answer it followed: the page kept
 * showing "working" until the next unrelated event. The first call still
 * fires at once, so a single event is never delayed.
 */
export function throttleTrailing(fn: () => void, windowMs: number) {
	let last = 0;
	let trailing: ReturnType<typeof setTimeout> | undefined;
	return {
		call() {
			const elapsed = Date.now() - last;
			if (elapsed >= windowMs) {
				last = Date.now();
				fn();
				return;
			}
			if (trailing) return;
			trailing = setTimeout(() => {
				trailing = undefined;
				last = Date.now();
				fn();
			}, windowMs - elapsed);
		},
		cancel() {
			clearTimeout(trailing);
			trailing = undefined;
		}
	};
}
