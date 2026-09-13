import { describe, expect, it } from 'vitest';
import { widthClasses } from './conversation-width';

describe('widthClasses', () => {
	/**
	 * A phone has one column and no room to argue about, so every variant has
	 * to leave it alone — anything else would be a desktop setting quietly
	 * changing the thing it was not about.
	 */
	it('leaves the phone width alone in every mode', () => {
		for (const w of ['comfortable', 'wide', 'full'] as const) {
			expect(widthClasses(w)).toContain('max-w-screen-sm');
		}
	});

	it('caps comfortable where it always did', () => {
		expect(widthClasses('comfortable')).toContain('2xl:max-w-5xl');
	});

	it('gives wide more room than comfortable', () => {
		expect(widthClasses('wide')).toContain('2xl:max-w-7xl');
	});

	/** Full means the column, so there must be no desktop cap at all. */
	it('takes the cap off entirely for full', () => {
		const full = widthClasses('full');
		expect(full).toContain('lg:max-w-none');
		expect(full).not.toContain('max-w-4xl');
		expect(full).not.toContain('max-w-5xl');
	});
});
