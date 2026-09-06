import { describe, expect, it } from 'vitest';
import { mergeResults } from './dictation';

const final = (transcript: string) => ({ 0: { transcript }, isFinal: true });
const interim = (transcript: string) => ({ 0: { transcript }, isFinal: false });

describe('mergeResults', () => {
	/** The Android shape that produced "I'm I'm just I'm just testing…" on a phone. */
	it('collapses cumulative finals to the longest', () => {
		const results = [final("I'm"), final("I'm just"), final("I'm just testing some stuff")];
		expect(mergeResults('', results).draft).toBe("I'm just testing some stuff");
	});

	it('counts a final the engine sent twice once', () => {
		expect(mergeResults('', [final('hello there'), final('hello there')]).draft).toBe(
			'hello there'
		);
	});

	it('keeps distinct finals in order, as desktop Chrome delivers them', () => {
		const results = [final('hello there'), final('how are you')];
		expect(mergeResults('', results).draft).toBe('hello there how are you');
	});

	it('separates what is heard from what is committed', () => {
		const merged = mergeResults('', [final('first sentence'), interim('and now')]);
		expect(merged).toEqual({ draft: 'first sentence', interim: 'and now' });
	});

	it('appends to the draft that stood when the session began', () => {
		expect(mergeResults('typed already', [final('then spoken')]).draft).toBe(
			'typed already then spoken'
		);
	});

	it('is idempotent: the same list twice gives the same draft', () => {
		const results = [final('one'), final('one two')];
		const once = mergeResults('base', results).draft;
		expect(mergeResults('base', results).draft).toBe(once);
		expect(once).toBe('base one two');
	});

	it('leaves the base alone when nothing has been committed yet', () => {
		expect(mergeResults('base', [interim('um')])).toEqual({ draft: 'base', interim: 'um' });
	});
});
