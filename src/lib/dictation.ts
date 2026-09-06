/**
 * Fold a Web Speech result list into the draft, idempotently.
 *
 * Desktop Chrome delivers each utterance once. Android's engine re-delivers
 * the sentence so far, longer each time and every copy marked final, and
 * sometimes sends the same final twice. Appending per event therefore wrote
 * "I'm I'm just I'm just testing…" on a phone. Rebuilding from the WHOLE list
 * every time, and collapsing a final that merely extends the previous one,
 * gives the same answer on both.
 */
export interface SpeechResultLike {
	0: { transcript: string };
	isFinal: boolean;
}

export interface Merged {
	/** The draft: what stood before the session, plus everything committed since. */
	draft: string;
	/** What the engine is hearing right now, not yet committed. */
	interim: string;
}

export function mergeResults(base: string, results: ArrayLike<SpeechResultLike>): Merged {
	const finals: string[] = [];
	let heard = '';
	for (let i = 0; i < results.length; i++) {
		const text = results[i][0].transcript.trim();
		if (!text) continue;
		if (results[i].isFinal) {
			// An exact repeat or a longer version of the previous final replaces it.
			const previous = finals.at(-1);
			if (previous !== undefined && text.startsWith(previous)) finals.pop();
			finals.push(text);
		} else {
			heard += ` ${text}`;
		}
	}
	const spoken = finals.join(' ');
	return {
		draft: spoken ? (base ? `${base} ${spoken}` : spoken) : base,
		interim: heard.trim()
	};
}
