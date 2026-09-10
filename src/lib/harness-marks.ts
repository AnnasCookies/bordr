/**
 * Marks for harnesses simple-icons does not carry.
 *
 * pi and omp publish their own logo, so these are conversions of the real
 * thing rather than something invented: pi.dev/logo-auto.svg and
 * can1357/oh-my-pi assets/icon.svg, flattened to one colour and fitted to the
 * 24-unit box. Each stays its project's mark; see static/LOGOS.md.
 *
 * Sizes are nudged where the source was drawn for a web page rather than for
 * 11px — omp's bar and plug are a shade heavier than the original, which is a
 * 120x90 logo whose plug came out as a smudge at this size.
 */
export interface Mark {
	d: string;
	/** Knockout shapes need evenodd; a mark of separate pieces must not use it. */
	evenodd?: boolean;
}

export const HARNESS_MARK: Record<string, Mark> = {
	// pi.dev/logo-auto.svg — the blocky P with its counter, and the i square.
	pi: { d: 'M1 1H17.5V12H12V17.5H6.5V23H1ZM6.5 6.5V12H12V6.5ZM17.5 12H23V23H17.5Z', evenodd: true },

	// can1357/oh-my-pi assets/icon.svg — a pi whose short leg ends in a plug.
	omp: {
		d:
			'M0.5 3.2H23.5V6.65H0.5ZM3.95 6.65H6.94V20.22H3.95ZM15.22 6.65H18.21V15.85H15.22Z' +
			'M14.07 13.32H19.59V17.92H14.07ZM15.22 14.36H16.37V16.89H15.22ZM17.29 14.36H18.44V16.89H17.29Z',
		evenodd: true
	},

	/*
	 * codex has no mark that works here. OpenAI's own is off the table —
	 * simple-icons removed it at their request — and the Codex CLI's splash
	 * draws itself as `>_`, which is the terminal symbol bordr already uses for
	 * a shell pane, so wearing it would make an agent look like a shell. This
	 * is a codex: a bound book, which is what the word means.
	 */
	codex: {
		d:
			'M2.5 5.2c2.8-1.2 5.6-1.7 8.4-1.5v14.6c-2.8-.2-5.6.3-8.4 1.5z' +
			'M21.5 5.2c-2.8-1.2-5.6-1.7-8.4-1.5v14.6c2.8-.2 5.6.3 8.4 1.5z'
	}
};
