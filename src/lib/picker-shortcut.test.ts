import { describe, expect, it } from 'vitest';
import { pickerShortcut, pickerIdentity } from './picker-shortcut';

const options = [
	{ index: 1, label: 'One', selected: true },
	{ index: 2, label: 'Two', selected: false }
];

describe('pickerShortcut', () => {
	it('maps a visible option number and refuses every other typed character', () => {
		expect(pickerShortcut('2', { options })).toEqual({ kind: 'answer', index: 2 });
		expect(pickerShortcut('3', { options })).toBeNull();
		expect(pickerShortcut('x', { options })).toBeNull();
	});

	it('defers Enter selection until earlier navigation has completed', () => {
		expect(pickerShortcut('Enter', { options })).toEqual({ kind: 'confirm' });
		expect(pickerShortcut('Enter', { options: [] })).toEqual({ kind: 'confirm' });
	});

	it('uses up and down for a normal picker without stealing sideways arrows', () => {
		expect(pickerShortcut('ArrowUp', { options })).toEqual({ kind: 'key', key: 'up' });
		expect(pickerShortcut('ArrowDown', { options })).toEqual({ kind: 'key', key: 'down' });
		expect(pickerShortcut('ArrowLeft', { options })).toBeNull();
	});

	it('uses left and right only for a horizontal slider', () => {
		const slider = { options, axis: 'horizontal' as const };
		expect(pickerShortcut('ArrowLeft', slider)).toEqual({ kind: 'key', key: 'left' });
		expect(pickerShortcut('ArrowRight', slider)).toEqual({ kind: 'key', key: 'right' });
		expect(pickerShortcut('ArrowDown', slider)).toBeNull();
	});
});

it('invalidates a new approval subject without invalidating arrow selection', () => {
	const picker = { question: 'Proceed?', context: ['tool A'], options };
	expect(pickerIdentity(picker)).toBe(
		pickerIdentity({ ...picker, options: options.map((o) => ({ ...o, selected: !o.selected })) })
	);
	expect(pickerIdentity(picker)).not.toBe(pickerIdentity({ ...picker, context: ['tool B'] }));
});
