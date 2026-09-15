import type { Picker } from '$lib/server/picker';

export type PickerShortcut =
	| { kind: 'confirm' }
	| { kind: 'answer'; index: number }
	| { kind: 'key'; key: 'up' | 'down' | 'left' | 'right' };

/**
 * Turn a desktop key into the same picker action Herdr's terminal would take.
 *
 * Digits choose the matching visible option and Enter confirms the highlighted
 * one through Bordr's verified answer route. Arrows only move the picker:
 * vertical lists take up/down and sliders take left/right, so an unrelated
 * arrow cannot accidentally leave a dialog.
 */
export function pickerShortcut(
	key: string,
	picker: Pick<Picker, 'options' | 'axis'>
): PickerShortcut | null {
	if (/^\d$/.test(key)) {
		const index = Number(key);
		return picker.options.some((option) => option.index === index)
			? { kind: 'answer', index }
			: null;
	}
	if (key === 'Enter') return { kind: 'confirm' };

	if (picker.axis === 'horizontal') {
		if (key === 'ArrowLeft') return { kind: 'key', key: 'left' };
		if (key === 'ArrowRight') return { kind: 'key', key: 'right' };
		return null;
	}
	if (key === 'ArrowUp') return { kind: 'key', key: 'up' };
	if (key === 'ArrowDown') return { kind: 'key', key: 'down' };
	return null;
}

/** Selection is excluded so arrow motion does not change dialog identity. */
export function pickerIdentity(picker: Pick<Picker, 'question' | 'options'> | null): string {
	return picker
		? [
				picker.question,
				...picker.options.map((o) => `${o.index}:${o.label}:${Boolean(o.writeIn)}`)
			].join('\0')
		: '';
}
