import { describe, expect, it } from 'vitest';
import { validateKeys } from './validate';

describe('validateKeys', () => {
	it('accepts navigation keys', () => {
		expect(validateKeys(['up', 'down', 'left', 'right', 'enter', 'esc', 'tab'])).toEqual([
			'up',
			'down',
			'left',
			'right',
			'enter',
			'esc',
			'tab'
		]);
	});

	it('rejects arbitrary key injection', () => {
		expect(() => validateKeys(['ctrl+c'])).toThrow();
		expect(() => validateKeys(['rm -rf /'])).toThrow();
		expect(() => validateKeys([';reboot'])).toThrow();
	});

	it('rejects an empty batch', () => {
		expect(() => validateKeys([])).toThrow();
	});

	it('caps the batch size', () => {
		expect(() => validateKeys(Array(30).fill('down'))).toThrow();
	});
});
