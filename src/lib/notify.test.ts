import { describe, expect, it } from 'vitest';
import { actionFor, chosenIndex, MAX_LABEL, offerable } from './notify';

describe('chosenIndex', () => {
	it('reads the index an answer button carries', () => {
		expect(chosenIndex('opt:1')).toBe(1);
		expect(chosenIndex('opt:12')).toBe(12);
	});

	/**
	 * The ordinary tap on the body of a notification has no action at all and
	 * means "open the agent". A zero here would silently answer the first
	 * option instead — a keystroke sent to a terminal because somebody
	 * looked at their phone.
	 */
	it('is null for a tap that is not an answer button', () => {
		expect(chosenIndex(undefined)).toBeNull();
		expect(chosenIndex('')).toBeNull();
		expect(chosenIndex('open')).toBeNull();
	});

	it('is null rather than NaN for a malformed one', () => {
		expect(chosenIndex('opt:')).toBeNull();
		expect(chosenIndex('opt:yes')).toBeNull();
	});
});

describe('actionFor', () => {
	it('puts the index in the id and the label on the button', () => {
		expect(actionFor({ index: 2, label: 'No, explain first' })).toEqual({
			action: 'opt:2',
			title: 'No, explain first'
		});
	});

	it('round-trips through chosenIndex', () => {
		expect(chosenIndex(actionFor({ index: 3, label: 'Maybe' }).action)).toBe(3);
	});

	/**
	 * A clipped label must SAY it was clipped. "Yes, and also delete the" reads
	 * as a whole option, and it is not the one you would be agreeing to.
	 */
	it('clips a long label and marks the cut', () => {
		const long = actionFor({ index: 1, label: 'Yes, and also rebuild the whole thing' });
		expect(long.title.length).toBeLessThanOrEqual(MAX_LABEL);
		expect(long.title.endsWith('\u2026')).toBe(true);
	});

	it('leaves a label that fits exactly alone', () => {
		const fits = 'x'.repeat(MAX_LABEL);
		expect(actionFor({ index: 0, label: fits }).title).toBe(fits);
	});
});

describe('offerable', () => {
	const three = [
		{ index: 1, label: 'Yes' },
		{ index: 2, label: 'No' },
		{ index: 3, label: 'Ask me later' }
	];

	it('offers at most the two a tray will show', () => {
		expect(offerable(three, false).map((c) => c.index)).toEqual([1, 2]);
	});

	/**
	 * A multi-select needs several taps and a confirm. One button for it would
	 * send something other than what the button says.
	 */
	it('offers nothing for a multi-select', () => {
		expect(offerable(three, true)).toEqual([]);
	});

	it('offers nothing when there is nothing to choose', () => {
		expect(offerable([], false)).toEqual([]);
	});
});
