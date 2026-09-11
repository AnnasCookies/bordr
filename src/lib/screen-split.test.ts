import { describe, expect, it } from 'vitest';
import { promptMark, splitAtPrompt } from './screen-split';

const ESC = String.fromCharCode(27);

describe('splitAtPrompt', () => {
	it('cuts a shell screen at its prompt row', () => {
		const parts = splitAtPrompt(['$ ls', 'bordr  repos', 'win-vm-omarchy master ❯', ''].join('\n'));
		expect(parts.above).toEqual(['$ ls', 'bordr  repos']);
		expect(parts.prompt).toBe('win-vm-omarchy master ❯');
		expect(parts.below).toEqual([]);
	});

	it('keeps the status footer a harness draws under its prompt', () => {
		const parts = splitAtPrompt(
			['Done.', '│ > ', '─────', 'CTX ▰▱▱ 46% · 540K left', 'auto mode on'].join('\n')
		);
		expect(parts.above).toEqual(['Done.']);
		expect(parts.prompt).toBe('│ > ');
		// The rule under the box is furniture, not a status row.
		expect(parts.below).toEqual(['CTX ▰▱▱ 46% · 540K left', 'auto mode on']);
	});

	/**
	 * The line that makes a naive "contains a marker" rule wrong: real output
	 * quoting a shell command sits above a real prompt, and scanning from the
	 * bottom must still land on the prompt.
	 */
	it('does not mistake output that merely mentions a marker', () => {
		const parts = splitAtPrompt(
			['  $ git push origin main', '  remote: done', 'tony@tm-work:~$ '].join('\n')
		);
		expect(parts.above).toEqual(['  $ git push origin main', '  remote: done']);
		expect(parts.prompt).toBe('tony@tm-work:~$ ');
	});

	it('ignores the empty terminal rows under the footer', () => {
		const parts = splitAtPrompt(['out', '❯', '', '', ''].join('\n'));
		expect(parts.prompt).toBe('❯');
		expect(parts.below).toEqual([]);
	});

	it('sees a prompt through its colour codes', () => {
		const coloured = `${ESC}[1m${ESC}[38;5;6mwin-vm-omarchy${ESC}[0m ${ESC}[3mmaster${ESC}[0m ❯ `;
		const parts = splitAtPrompt(['work', coloured].join('\n'));
		expect(parts.prompt).toBe(coloured);
		expect(promptMark(parts.prompt)).toBe('❯');
	});

	/**
	 * A harness pads between its last output and its input box with empty
	 * rows. Carried through, they became a screenful of nothing between the
	 * output and bordr's own box.
	 */
	it('drops the padding a harness leaves above its prompt', () => {
		const parts = splitAtPrompt(['done.', '', '', '', '❯', 'CTX 46%'].join('\n'));
		expect(parts.above).toEqual(['done.']);
		expect(parts.below).toEqual(['CTX 46%']);
	});

	it('gives everything back as output when there is no prompt at all', () => {
		const parts = splitAtPrompt(['building…', '[==>    ] 40%'].join('\n'));
		expect(parts.prompt).toBe('');
		expect(parts.above).toEqual(['building…', '[==>    ] 40%']);
		expect(parts.below).toEqual([]);
	});
});

describe('a prompt line with text already typed into it', () => {
	/**
	 * bordr flushes the draft into the pane before Tab/Up/Down, so the input
	 * line is routinely non-empty. It used to stop matching at that point and
	 * the scan climbed to the blockquote's `>` above, burying three lines of
	 * real output — and the command about to run — in the status strip.
	 */
	it('splits at the filled input line, not at a blockquote above it', () => {
		const screen = [
			'Here is the summary:',
			'',
			'The build passed and I pushed the branch.',
			'> All 42 tests are green.',
			'│ > deploy to production',
			'CTX 46%'
		].join('\n');
		const parts = splitAtPrompt(screen);
		expect(parts.prompt).toBe('│ > deploy to production');
		expect(parts.below).toEqual(['CTX 46%']);
		expect(parts.above).toContain('The build passed and I pushed the branch.');
	});

	it('still prefers an empty prompt row when there is one', () => {
		const screen = ['out > quoted', 'work done', '❯', 'CTX 9%'].join('\n');
		const parts = splitAtPrompt(screen);
		expect(parts.prompt).toBe('❯');
		expect(parts.below).toEqual(['CTX 9%']);
	});

	it('does not treat quoted text deep in scrollback as a prompt', () => {
		const screen = ['> a quote', ...Array(9).fill('plain output')].join('\n');
		expect(splitAtPrompt(screen).prompt).toBe('');
	});
});
