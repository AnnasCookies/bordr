import { describe, expect, it } from 'vitest';
import { extractActivity } from './activity';

describe('extractActivity', () => {
	it('reads the working line, its elapsed time and its token count', () => {
		// Captured live from a Claude Code pane.
		const screen = ['some output', '✢ Channeling… (4m 36s · ↓ 6.5k tokens)'].join('\n');
		expect(extractActivity(screen)).toEqual({
			text: 'Channeling… (4m 36s · ↓ 6.5k tokens)',
			tip: null
		});
	});

	it('picks up the tip underneath it', () => {
		const screen = [
			'✢ Channeling… (4m 36s · ↓ 6.5k tokens)',
			"  ⎿  Tip: Use /btw to ask a quick side question without interrupting Claude's current work"
		].join('\n');
		expect(extractActivity(screen)?.tip).toBe(
			"Use /btw to ask a quick side question without interrupting Claude's current work"
		);
	});

	it('reads the finished line too', () => {
		expect(extractActivity('✻ Sautéed for 5m 8s · done 12:43 AM')?.text).toBe(
			'Sautéed for 5m 8s · done 12:43 AM'
		);
	});

	it('takes the LAST spinner row, not an older one left on screen', () => {
		const screen = ['✻ Brewed for 9s · done 11:15 PM', 'more output', '✢ Thinking… (2s)'].join('\n');
		expect(extractActivity(screen)?.text).toBe('Thinking… (2s)');
	});

	it('never mistakes a status bar row for activity', () => {
		// The usage bars start with a glyph too, and matching one would put a
		// context meter where the verb goes.
		const screen = ['· CTX ▰▰▰▱▱▱▱▱▱▱ 48% 478.9K/1.0M'].join('\n');
		expect(extractActivity(screen)).toBeNull();
	});

	it('is null on a screen with no activity at all', () => {
		expect(extractActivity('just some output\nand more')).toBeNull();
	});
});
