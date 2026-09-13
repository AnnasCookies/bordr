import { describe, expect, it } from 'vitest';
import { afterClose } from './after-close';

const TAB = ['w1:p1', 'w1:p2', 'w1:p3'];
const ALL = ['w1:p1', 'w1:p2', 'w1:p3', 'w2:p1', 'w3:p1'];

describe('afterClose', () => {
	it('goes to the next pane in the same tab', () => {
		expect(afterClose({ scope: 'pane', current: 'w1:p1', siblings: TAB, all: ALL })).toBe('w1:p2');
	});

	/** The list is in tab order, so "next" from the middle is the first survivor. */
	it('skips the one that was closed, wherever it sat', () => {
		expect(afterClose({ scope: 'pane', current: 'w1:p2', siblings: TAB, all: ALL })).toBe('w1:p1');
	});

	/**
	 * A closed TAB takes every pane in it, so none of them can be the answer —
	 * the whole point of passing the scope through rather than assuming a pane.
	 */
	it('leaves the tab entirely when the tab is what closed', () => {
		expect(afterClose({ scope: 'tab', current: 'w1:p1', siblings: TAB, all: ALL })).toBe('w2:p1');
	});

	it('falls back to any other agent when the tab held only that pane', () => {
		expect(afterClose({ scope: 'pane', current: 'w3:p1', siblings: ['w3:p1'], all: ALL })).toBe(
			'w1:p1'
		);
	});

	/** Null, so the caller sends you to the agents list rather than nowhere. */
	it('has nothing to offer when that was the last one', () => {
		expect(
			afterClose({ scope: 'pane', current: 'w1:p1', siblings: ['w1:p1'], all: ['w1:p1'] })
		).toBe(null);
		expect(afterClose({ scope: 'tab', current: 'w1:p1', siblings: TAB, all: TAB })).toBe(null);
	});

	it('copes with a list that never mentioned the pane', () => {
		expect(afterClose({ scope: 'pane', current: 'w9:p9', siblings: [], all: ALL })).toBe('w1:p1');
	});
});
