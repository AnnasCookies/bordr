import { describe, expect, it } from 'vitest';
import { isEmptyQuery, matchIndex, matchLength, parseSearchQuery } from './search-query';

describe('parseSearchQuery', () => {
	it('treats bare words as terms that must all appear', () => {
		expect(parseSearchQuery('deploy smoke')).toEqual({
			terms: ['deploy', 'smoke'],
			phrases: [],
			exclude: []
		});
	});

	it('keeps a quoted phrase whole', () => {
		expect(parseSearchQuery('"stuck reconnecting" bordr').phrases).toEqual(['stuck reconnecting']);
	});

	it('reads a leading dash as an exclusion, quoted or not', () => {
		const q = parseSearchQuery('deploy -smoke -"dry run"');
		expect(q.terms).toEqual(['deploy']);
		expect(q.exclude).toEqual(['smoke', 'dry run']);
	});

	it('is case-insensitive', () => {
		expect(parseSearchQuery('Deploy "Smoke Test"')).toEqual({
			terms: ['deploy'],
			phrases: ['smoke test'],
			exclude: []
		});
	});

	it('ignores a bare dash and empty quotes rather than matching everything', () => {
		const q = parseSearchQuery('- "" deploy');
		expect(q.terms).toEqual(['-', 'deploy']);
		expect(q.phrases).toEqual([]);
	});

	it('knows a query with only exclusions has nothing to find', () => {
		expect(isEmptyQuery(parseSearchQuery('-noise'))).toBe(true);
		expect(isEmptyQuery(parseSearchQuery('deploy'))).toBe(false);
	});
});

describe('matchIndex', () => {
	const text = 'We ran the smoke test after the deploy finished';

	it('requires every term, not just one', () => {
		expect(matchIndex(text, parseSearchQuery('smoke deploy'))).toBeGreaterThan(-1);
		expect(matchIndex(text, parseSearchQuery('smoke missing'))).toBe(-1);
	});

	it('anchors on the earliest hit so the snippet opens at the right place', () => {
		// "deploy" appears later than "smoke"; the snippet should start at smoke.
		expect(matchIndex(text, parseSearchQuery('deploy smoke'))).toBe(text.indexOf('smoke'));
	});

	it('matches a phrase only when the words are adjacent', () => {
		expect(matchIndex(text, parseSearchQuery('"smoke test"'))).toBe(text.indexOf('smoke'));
		expect(matchIndex(text, parseSearchQuery('"test smoke"'))).toBe(-1);
	});

	it('rejects a message containing an excluded word even when the terms match', () => {
		expect(matchIndex(text, parseSearchQuery('smoke -deploy'))).toBe(-1);
		expect(matchIndex(text, parseSearchQuery('smoke -rollback'))).toBeGreaterThan(-1);
	});

	it('reports the length of the needle that matched, for snippet sizing', () => {
		expect(matchLength(text, parseSearchQuery('"smoke test"'))).toBe('smoke test'.length);
		expect(matchLength(text, parseSearchQuery('nothinghere'))).toBe(0);
	});
});
