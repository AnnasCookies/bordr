/**
 * Marks drawn here, for harnesses that have no usable logo.
 *
 * simple-icons carries no OpenAI or xAI icon — both were removed at the
 * owners' request — and pi and omp have no published mark at all. Rather than
 * a generic glyph, each gets a mark that means something: pi is the letter it
 * is named after, omp (oh-my-pi) is that letter reversed out of a tile because
 * it wraps pi, and codex is a codex — a bound book, which is what the word is.
 *
 * Drawn thick on purpose: these render at 11-13px, where a two-unit stroke in
 * a 24-unit box is half a pixel and disappears.
 */
export interface Mark {
	d: string;
	/** Knockout shapes need evenodd; a mark of separate pieces must not use it. */
	evenodd?: boolean;
}

export const HARNESS_MARK: Record<string, Mark> = {
	// π: top bar and two legs, as one closed outline.
	pi: { d: 'M3.5 5.5h17v3.2h-3.8v10.8h-3.2V8.7H9.6v10.8H6.4V8.7H3.5z' },

	// oh-my-pi: the same letter, reversed out of a rounded tile.
	omp: {
		d:
			'M5 1h14a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4V5a4 4 0 0 1 4-4z' +
			'M5.5 6.5h13V9h-2.5v8.5h-2.2V9h-3.6v8.5H8V9H5.5z',
		evenodd: true
	},

	// codex: an open book, two leaves meeting at the spine.
	codex: {
		d:
			'M2.5 5.2c2.8-1.2 5.6-1.7 8.4-1.5v14.6c-2.8-.2-5.6.3-8.4 1.5z' +
			'M21.5 5.2c-2.8-1.2-5.6-1.7-8.4-1.5v14.6c2.8-.2 5.6.3 8.4 1.5z'
	}
};
