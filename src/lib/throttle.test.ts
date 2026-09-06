import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttleTrailing } from './throttle';

describe('throttleTrailing', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('fires the first call at once', () => {
		const fn = vi.fn();
		const gate = throttleTrailing(fn, 300);
		gate.call();
		expect(fn).toHaveBeenCalledTimes(1);
	});

	/**
	 * The regression this exists for: the final event of a burst used to be
	 * dropped, so a "done" 200 ms after the last refresh was never shown.
	 */
	it('defers rather than drops a call inside the window', () => {
		const fn = vi.fn();
		const gate = throttleTrailing(fn, 300);
		gate.call();
		vi.advanceTimersByTime(200);
		gate.call();
		expect(fn).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('collapses a burst into one trailing call', () => {
		const fn = vi.fn();
		const gate = throttleTrailing(fn, 300);
		gate.call();
		for (let i = 0; i < 5; i++) {
			vi.advanceTimersByTime(40);
			gate.call();
		}
		vi.advanceTimersByTime(300);
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('cancel drops the pending trailing call', () => {
		const fn = vi.fn();
		const gate = throttleTrailing(fn, 300);
		gate.call();
		vi.advanceTimersByTime(100);
		gate.call();
		gate.cancel();
		vi.advanceTimersByTime(500);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
