/**
 * Colour maths for the message-bubble settings.
 *
 * Users pick a bubble colour; the text on it has to stay readable. WCAG's
 * relative-luminance formula is the standard way to decide that, and it is
 * cheap enough to run on every keystroke of a colour picker.
 */

/** #rgb or #rrggbb → [r, g, b] 0-255, or null when it is not a hex colour. */
export function parseHex(value: string): [number, number, number] | null {
	const hex = value.trim().replace(/^#/, '');
	if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
	const full =
		hex.length === 3
			? hex
					.split('')
					.map((c) => c + c)
					.join('')
			: hex;
	return [
		parseInt(full.slice(0, 2), 16),
		parseInt(full.slice(2, 4), 16),
		parseInt(full.slice(4, 6), 16)
	];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(colour: string): number {
	const rgb = parseHex(colour);
	if (!rgb) return 0;
	const [r, g, b] = rgb.map((channel) => {
		const v = channel / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (light + 0.05) / (dark + 0.05);
}

/**
 * Black or white, whichever is more readable on this background.
 *
 * Used to seed the text colour when someone picks a bubble colour, so the
 * default is always legible even if they never open the text picker.
 */
export function readableTextOn(background: string): string {
	return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#000000')
		? '#ffffff'
		: '#000000';
}

/** WCAG AA for body text. Below this, the pair is worth warning about. */
export const AA_NORMAL = 4.5;

export function meetsAA(background: string, text: string): boolean {
	return contrastRatio(background, text) >= AA_NORMAL;
}
