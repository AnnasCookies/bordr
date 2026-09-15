import { describe, expect, it } from 'vitest';
import { homeBelowAfter, replacesHistory, stepsBackHome } from './back';

describe('replacesHistory', () => {
	it('pushes leaving the agents list, and replaces everywhere else', () => {
		expect(replacesHistory('home', '/')).toBe(false);
		expect(replacesHistory('home', '/a/w1:p1')).toBe(true);
		expect(replacesHistory('home', '/f/dev/project')).toBe(true);
		expect(replacesHistory('home', '/settings')).toBe(true);
	});

	it('pushes everything when back should retrace', () => {
		expect(replacesHistory('history', '/f/dev/project')).toBe(false);
		expect(replacesHistory('history', '/a/w1:p1')).toBe(false);
	});
});

describe('homeBelowAfter', () => {
	/** The journey that took five backs: the list, Files, then folders. */
	it('knows the list is below from the first move until it is back on the list', () => {
		let below = homeBelowAfter(false, { type: 'enter', from: null, to: '/' });
		expect(below).toBe(false);
		below = homeBelowAfter(below, { type: 'link', from: '/', to: '/f' });
		expect(below).toBe(true);
		below = homeBelowAfter(below, { type: 'link', from: '/f', to: '/f/dev' });
		expect(below).toBe(true);
		below = homeBelowAfter(below, { type: 'popstate', from: '/f/dev', to: '/' });
		expect(below).toBe(false);
	});

	it('has nothing below a cold start into a pane', () => {
		let below = homeBelowAfter(true, { type: 'enter', from: null, to: '/a/w1:p1' });
		expect(below).toBe(false);
		below = homeBelowAfter(below, { type: 'link', from: '/a/w1:p1', to: '/a/w1:p2' });
		expect(below).toBe(false);
	});
});

describe('stepsBackHome', () => {
	const toList = { type: 'link', from: '/f/dev', to: '/', search: '' };

	it('steps back onto the list that is already there', () => {
		expect(stepsBackHome('home', true, toList)).toBe(true);
		expect(stepsBackHome('home', true, { ...toList, type: 'goto' })).toBe(true);
	});

	it('pushes when there is no list below to step back to', () => {
		expect(stepsBackHome('home', false, toList)).toBe(false);
	});

	it('leaves Retrace, a query, popstate and a same-page tap alone', () => {
		expect(stepsBackHome('history', true, toList)).toBe(false);
		expect(stepsBackHome('home', true, { ...toList, search: '?shared=a.png' })).toBe(false);
		expect(stepsBackHome('home', true, { ...toList, type: 'popstate' })).toBe(false);
		expect(stepsBackHome('home', true, { ...toList, from: '/' })).toBe(false);
	});
});
