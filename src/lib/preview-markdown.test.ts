import { describe, expect, it } from 'vitest';
import { previewPlain, previewSegments } from './preview-markdown';

describe('previewSegments', () => {
	it('marks bold and code, and keeps the text between them', () => {
		expect(previewSegments('**Done** — see `git push` now')).toEqual([
			{ text: 'Done', mark: 'strong' },
			{ text: ' — see ', mark: 'plain' },
			{ text: 'git push', mark: 'code' },
			{ text: ' now', mark: 'plain' }
		]);
	});

	it('drops the block marker a heading or a bullet starts with', () => {
		expect(previewPlain('## LL-FH = Farnham changes the picture')).toBe(
			'LL-FH = Farnham changes the picture'
		);
		expect(previewPlain('- Added to the same draft')).toBe('Added to the same draft');
		expect(previewPlain('> quoted thing')).toBe('quoted thing');
		expect(previewPlain('1. first thing')).toBe('first thing');
	});

	/**
	 * The preview is clipped to 80 characters BEFORE this runs, so ending
	 * mid-span is the normal case, not an error. A marker with no partner has
	 * to stay as the characters the agent typed — swallowing the rest of the
	 * line would hide the only text there is.
	 */
	it('leaves an unterminated marker as plain text', () => {
		expect(previewPlain('**Done, and the machine is heal…')).toBe(
			'**Done, and the machine is heal…'
		);
		expect(previewPlain('run `git pus…')).toBe('run `git pus…');
	});

	it('keeps a link label and drops its target', () => {
		expect(previewPlain('see [the PR](https://github.com/sling86/bordr/pull/12) for why')).toBe(
			'see the PR for why'
		);
	});

	/**
	 * A lone asterisk is as often a glob or a shell argument as it is
	 * emphasis, and at 10px italic buys nothing worth guessing wrong about.
	 */
	it('leaves single asterisks alone', () => {
		expect(previewPlain('rm -rf build/*.map and *maybe* more')).toBe(
			'rm -rf build/*.map and *maybe* more'
		);
	});

	it('always returns something for text with no markup', () => {
		expect(previewSegments('just a plain line')).toEqual([
			{ text: 'just a plain line', mark: 'plain' }
		]);
		expect(previewSegments('')).toEqual([{ text: '', mark: 'plain' }]);
	});

	it('leaves the preview prefixes the server adds untouched', () => {
		expect(previewPlain('▸ Bash bun run build')).toBe('▸ Bash bun run build');
		expect(previewPlain('✓ **Done** — dc05849')).toBe('✓ Done — dc05849');
	});
});

describe('collapsed block syntax', () => {
	/**
	 * A preview is several lines squashed into one, so a heading marker turns
	 * up mid-sentence rather than at the start.
	 */
	it('drops a heading that ended up in the middle of the line', () => {
		expect(previewPlain('Both noted and corrected in ctxc. ## LL-FH = Farnham')).toBe(
			'Both noted and corrected in ctxc. LL-FH = Farnham'
		);
	});

	/**
	 * One hash mid-sentence is an issue number or a C# far more often than a
	 * heading, and neither has a space after it.
	 */
	it('keeps a single hash, which is usually an issue number', () => {
		expect(previewPlain('fixed in #8376 and ctxc #11967')).toBe('fixed in #8376 and ctxc #11967');
		expect(previewPlain('the C# side is fine')).toBe('the C# side is fine');
	});

	it("drops a table's delimiter row and its run of empty cells", () => {
		expect(previewPlain('Done. | | | |---|---| | `NODE-4421B3D9` | online')).toBe(
			'Done. | NODE-4421B3D9 | online'
		);
	});
});
