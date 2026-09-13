import { describe, expect, it } from 'vitest';
import { parseModelLine } from './model-line';

/** Every line here was copied off a live pane. */
const CLAUDE =
	'\u{f06a9} Opus 5 \u{f04c5} high \u{f487} bordr · \u{f0443} inline-worker · 🪨 LITE · \u{f07c} ~/bordr';
const CLAUDE_1M =
	'\u{f06a9} Opus 5 1M \u{f04c5} high · Auto mode permission prompts · \u{f0443} inline-worker';
const CODEX = '\u{f06a9} CODEX PRO · OAuth subscription · 272.0K ctx · 128.0K out';
const CTX = '\u{f46d} CTX  ▰▰▰▰▰▰▱▱▱▱ ⣶⣶⣶⣦⣤⣶⣶⣶  58%  578.8K/1.0M · 421.2K left';
/** The same speedometer, labelling a spend row rather than an effort. */
const RUN = '\u{f04c5} RUN  \u{f02ca} 4.4M in · \u{f005d} 376.9K out · \u{f0219} $90.165';

describe('parseModelLine', () => {
	it('reads the model and the effort', () => {
		expect(parseModelLine([CLAUDE])).toEqual({ model: 'Opus 5', effort: 'high' });
	});

	/** A model name can carry a suffix, and it is part of the name. */
	it('keeps a qualified model name whole', () => {
		expect(parseModelLine([CLAUDE_1M])).toEqual({ model: 'Opus 5 1M', effort: 'high' });
	});

	it('stops the model at the first separator', () => {
		expect(parseModelLine([CODEX])).toEqual({ model: 'CODEX PRO', effort: '' });
	});

	it('finds the row wherever it sits', () => {
		expect(parseModelLine([CTX, CLAUDE]).model).toBe('Opus 5');
	});

	/**
	 * The trap. The statusline uses the speedometer twice — once for effort and
	 * once to label a spend row — so an effort read from whichever line it
	 * turned up on first reports "RUN".
	 */
	it('does not take the effort from a different row', () => {
		expect(parseModelLine([CODEX, RUN])).toEqual({ model: 'CODEX PRO', effort: '' });
		expect(parseModelLine([RUN, CODEX])).toEqual({ model: 'CODEX PRO', effort: '' });
	});

	/**
	 * The guard that makes reading a user-configurable line defensible at all:
	 * a value that is not recognisably an effort level is discarded rather than
	 * announced. Somebody else's layout yields nothing, not nonsense.
	 */
	it('refuses a value that is not an effort level', () => {
		const odd = '\u{f06a9} Opus 5 \u{f04c5} feat/rich-transcript · \u{f07c} ~/bordr';
		expect(parseModelLine([odd])).toEqual({ model: 'Opus 5', effort: '' });
	});

	it('accepts every level the harnesses offer, however cased', () => {
		for (const level of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto']) {
			const line = `\u{f06a9} Opus 5 \u{f04c5} ${level.toUpperCase()} · x`;
			expect(parseModelLine([line]).effort).toBe(level);
		}
	});

	it('has nothing to say about a harness that prints no status', () => {
		expect(parseModelLine([])).toEqual({ model: '', effort: '' });
		expect(parseModelLine([CTX, RUN])).toEqual({ model: '', effort: '' });
	});
});
