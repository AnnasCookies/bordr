import { describe, expect, it } from 'vitest';
import { FIRST_WAIT_MS, MAX_WAIT_MS, recoverable, waitFor } from './recover';

describe('recoverable', () => {
	it('retries a server that is down or unwell', () => {
		expect(recoverable(500)).toBe(true);
		expect(recoverable(502)).toBe(true);
		expect(recoverable(503)).toBe(true);
	});

	/** A fetch that never reached anything has no status at all. */
	it('retries a request that never landed', () => {
		expect(recoverable(0)).toBe(true);
	});

	it('retries a timeout and a rate limit', () => {
		expect(recoverable(408)).toBe(true);
		expect(recoverable(429)).toBe(true);
	});

	/**
	 * The half that matters. A pane that has closed is never coming back, and
	 * a page that retries it for ever is a spinner that lies.
	 */
	it('does not retry a failure that needs a person', () => {
		expect(recoverable(404)).toBe(false);
		expect(recoverable(403)).toBe(false);
		expect(recoverable(401)).toBe(false);
		expect(recoverable(400)).toBe(false);
	});

	it('does not retry a success', () => {
		expect(recoverable(200)).toBe(false);
		expect(recoverable(302)).toBe(false);
	});
});

describe('waitFor', () => {
	it('starts short so a blip is invisible', () => {
		expect(waitFor(0)).toBe(FIRST_WAIT_MS);
	});

	it('doubles while it keeps failing', () => {
		expect(waitFor(1)).toBe(FIRST_WAIT_MS * 2);
		expect(waitFor(2)).toBe(FIRST_WAIT_MS * 4);
	});

	/** A phone in a pocket for an hour must not be asking every two seconds. */
	it('caps, however long it has been failing', () => {
		expect(waitFor(10)).toBe(MAX_WAIT_MS);
		expect(waitFor(1000)).toBe(MAX_WAIT_MS);
	});

	it('treats a nonsense attempt count as the first', () => {
		expect(waitFor(-5)).toBe(FIRST_WAIT_MS);
	});
});
