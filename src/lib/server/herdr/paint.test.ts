import { describe, expect, it } from 'vitest';
import { paintToScreen } from './paint';

const E = '\x1b';
// The preamble every core 0.1.17 paint starts with: mode resets, clear, tab stops.
const PREAMBLE = `\x18${E}[!p${E}[?2026l${E}[?1049l${E}[H${E}[2J${E}[?2004h${E}[3g${E}[9G${E}H${E}[17G${E}H${E}[H`;

describe('paintToScreen', () => {
	it('reads a one-row shell paint (captured from bash)', () => {
		const paint = `${PREAMBLE}bash-5.3$ xy${E}[1;13H${E}[0m${E}[?9001l`;
		expect(paintToScreen(paint)).toBe(`bash-5.3$ xy${E}[0m`);
	});

	it('keeps colour and dim, splits rows on CRLF, drops title, status and key modes', () => {
		const paint =
			`${PREAMBLE}\r\n${E}[0m${E}[38;2;122;131;148m● tool${E}[0m\r\n` +
			`${E}[2m❯ ghost${E}[0m${E}[>4;2m${E}[34;3H${E}[0m${E}[=5;1u${E}(B` +
			`${E}]2;A title${E}\\${E}[?9001l${E}]7501;state=done:app=claude-code${E}\\`;
		expect(paintToScreen(paint)).toBe(
			`\n${E}[0m${E}[38;2;122;131;148m● tool${E}[0m\n${E}[2m❯ ghost${E}[0m${E}[0m`
		);
	});

	it('passes a paint with no home through, minus controls', () => {
		expect(paintToScreen(`plain\r\ntext${E}[?25l`)).toBe('plain\ntext');
	});
});
