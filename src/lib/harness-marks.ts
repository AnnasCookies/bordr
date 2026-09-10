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
	/** The source's own viewBox, where refitting the path would risk mangling it. */
	box?: string;
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
	 * OpenAI's mark, from openai/openai-assistants-quickstart public/openai.svg
	 * — their own repo, their own asset. Kept in its 32-unit box rather than
	 * refitted: the path is one 950-character outline and rescaling it by hand
	 * is all risk and no gain when the viewBox does the same job.
	 */
	codex: {
		d: 'M29.71,13.09A8.09,8.09,0,0,0,20.34,2.68a8.08,8.08,0,0,0-13.7,2.9A8.08,8.08,0,0,0,2.3,18.9,8,8,0,0,0,3,25.45a8.08,8.08,0,0,0,8.69,3.87,8,8,0,0,0,6,2.68,8.09,8.09,0,0,0,7.7-5.61,8,8,0,0,0,5.33-3.86A8.09,8.09,0,0,0,29.71,13.09Zm-12,16.82a6,6,0,0,1-3.84-1.39l.19-.11,6.37-3.68a1,1,0,0,0,.53-.91v-9l2.69,1.56a.08.08,0,0,1,.05.07v7.44A6,6,0,0,1,17.68,29.91ZM4.8,24.41a6,6,0,0,1-.71-4l.19.11,6.37,3.68a1,1,0,0,0,1,0l7.79-4.49V22.8a.09.09,0,0,1,0,.08L13,26.6A6,6,0,0,1,4.8,24.41ZM3.12,10.53A6,6,0,0,1,6.28,7.9v7.57a1,1,0,0,0,.51.9l7.75,4.47L11.85,22.4a.14.14,0,0,1-.09,0L5.32,18.68a6,6,0,0,1-2.2-8.18Zm22.13,5.14-7.78-4.52L20.16,9.6a.08.08,0,0,1,.09,0l6.44,3.72a6,6,0,0,1-.9,10.81V16.56A1.06,1.06,0,0,0,25.25,15.67Zm2.68-4-.19-.12-6.36-3.7a1,1,0,0,0-1.05,0l-7.78,4.49V9.2a.09.09,0,0,1,0-.09L19,5.4a6,6,0,0,1,8.91,6.21ZM11.08,17.15,8.38,15.6a.14.14,0,0,1-.05-.08V8.1a6,6,0,0,1,9.84-4.61L18,3.6,11.61,7.28a1,1,0,0,0-.53.91ZM12.54,14,16,12l3.47,2v4L16,20l-3.47-2Z',
		box: '0 0 32 32'
	}
};
