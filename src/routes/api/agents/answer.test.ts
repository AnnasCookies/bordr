import { describe, expect, it } from 'vitest';
import { keysForOption } from '$lib/server/picker';

describe('keysForOption', () => {
	it('sends the option digit — absolute, so no arrow counting', () => {
		expect(keysForOption(3)).toEqual(['3']);
	});

	it('falls back to arrows beyond single digits', () => {
		expect(keysForOption(12, 1)).toEqual([
			'down',
			'down',
			'down',
			'down',
			'down',
			'down',
			'down',
			'down',
			'down',
			'down',
			'down',
			'enter'
		]);
	});

	it('sends only enter when the wanted option is already highlighted', () => {
		expect(keysForOption(11, 11)).toEqual(['enter']);
	});
});
