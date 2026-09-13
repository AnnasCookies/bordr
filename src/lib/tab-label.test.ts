import { describe, expect, it } from 'vitest';
import { tabName } from './tab-label';

describe('tabName', () => {
	/** Every one of these came off a live `tab.list`. */
	it('drops the spinner frame herdr sampled', () => {
		expect(tabName('◑ Bordr exploration')).toBe('Bordr exploration');
		expect(tabName('◐ Bitwarden CLI integration')).toBe('Bitwarden CLI integration');
		expect(tabName('◐ PC1ZFQR7 Intune enrollment')).toBe('PC1ZFQR7 Intune enrollment');
	});

	it("drops omp's marker and prompt arrow", () => {
		expect(tabName('π > Assess bordr functionality with omp')).toBe(
			'Assess bordr functionality with omp'
		);
		expect(tabName('π ⠹ Compare Windows OMP Setup')).toBe('Compare Windows OMP Setup');
	});

	/**
	 * The important half. Stripping is only safe because it can never touch a
	 * letter or a digit — a tab named for its repo has to survive exactly.
	 */
	it('leaves a plain name completely alone', () => {
		expect(tabName('ctxc')).toBe('ctxc');
		expect(tabName('ci and reviews')).toBe('ci and reviews');
		expect(tabName('Matt H PC Alert')).toBe('Matt H PC Alert');
		expect(tabName('thf-dev server work')).toBe('thf-dev server work');
	});

	/** A name that merely CONTAINS a glyph is not a decorated name. */
	it('strips only from the front', () => {
		expect(tabName('deploy → staging')).toBe('deploy → staging');
		expect(tabName('a ◐ b')).toBe('a ◐ b');
	});

	it('keeps a name that is nothing but a glyph', () => {
		expect(tabName('◐')).toBe('◐');
		expect(tabName('π')).toBe('π');
	});

	it('has nothing to say about an empty label', () => {
		expect(tabName('')).toBe('');
		expect(tabName('   ')).toBe('');
	});
});
