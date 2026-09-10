import { error, json } from '@sveltejs/kit';
import { promptAgent, rawAgent, readVisible, sendKeys } from '$lib/server/herdr';
import { keysForOption, parsePicker, pendingAsk, type Picker } from '$lib/server/picker';
import { adapterFor } from '$lib/server/transcript';
import { readTranscriptTail } from '$lib/server/transcript/tail';
import type { RequestHandler } from './$types';

/** The question a harness asked through a tool, from its transcript, if still unanswered. */
async function transcriptAsk(paneId: string): Promise<Picker | null> {
	const raw = await rawAgent(paneId);
	if (!raw) return null;
	const sessionId = (raw.agent_session as { value?: string } | undefined)?.value;
	const adapter = adapterFor(String(raw.agent ?? ''));
	if (!sessionId || !adapter) return null;
	const path = await adapter.resolve(sessionId);
	if (!path) return null;
	return pendingAsk(adapter.parse((await readTranscriptTail(path)).text));
}

export const POST: RequestHandler = async ({ params, request }) => {
	const { index, submit } = (await request.json()) as { index?: number; submit?: boolean };
	if (typeof index !== 'number' && submit !== true) throw error(400, 'index or submit required');

	// Re-read rather than trusting the client's view — the picker may have
	// changed or been dismissed since the page rendered it.
	const picker = parsePicker(await readVisible(params.pane)) ?? (await transcriptAsk(params.pane));
	if (!picker) throw error(409, 'no picker on screen');

	if (picker.answer === 'text') {
		if (typeof index !== 'number') throw error(400, 'index is required');
		const wanted = picker.options.find((o) => o.index === index);
		if (!wanted) throw error(409, `option ${index} is not on screen`);
		// No dialog to drive: the harness is polling for typed input.
		await promptAgent(params.pane, wanted.label);
		// The rollout file lags the reply by a beat; look twice before doubting.
		let still: Picker | null = picker;
		for (let attempt = 0; attempt < 2 && still; attempt++) {
			await new Promise((r) => setTimeout(r, 1_500));
			still = await transcriptAsk(params.pane);
		}
		return json({ ok: true, chose: wanted.label, outcome: still ? 'unknown' : 'accepted' });
	}

	if (submit === true) {
		if (!picker.multi) throw error(409, 'not a multi-select picker');
		// Enter TOGGLES on checkbox rows and only submits from the Submit row
		// (where no numbered row carries the highlight marker). Navigate with
		// bare downs until the marker disappears, then Enter, then verify.
		for (let attempt = 0; attempt < 4; attempt++) {
			const current = parsePicker(await readVisible(params.pane));
			if (!current?.multi) return json({ ok: true, chose: 'submit' });
			const highlighted = current.options.find((o) => o.selected)?.index;
			if (highlighted === undefined) {
				await sendKeys(params.pane, ['enter']);
			} else {
				const boxes = current.options.filter((o) => o.checked !== undefined);
				const maxBox = Math.max(...boxes.map((o) => o.index));
				const downs = Math.max(1, maxBox - highlighted + 1);
				await sendKeys(params.pane, Array(downs).fill('down'));
			}
			await new Promise((r) => setTimeout(r, 800));
		}
		throw error(409, 'could not reach the Submit row — is a write-in option ticked?');
	}
	if (typeof index !== 'number') throw error(400, 'index is required');

	const wanted = picker.options.find((o) => o.index === index);
	if (!wanted) throw error(409, `option ${index} is not on screen`);

	const send = (keys: string[]) => sendKeys(params.pane, keys);
	const settle = () => new Promise((r) => setTimeout(r, 500));
	const sameDialog = (a: Picker, b: Picker) =>
		a.options.length === b.options.length &&
		a.options.every((o, i) => o.label === b.options[i].label);

	const current = picker.options.find((o) => o.selected)?.index;
	await send(keysForOption(index, current, picker.numbered, picker.axis));

	// Verify rather than assume. A half-landed answer otherwise looks
	// identical to a clean one, and a blind retry could answer twice.
	await settle();
	let outcome: 'accepted' | 'unknown' = 'unknown';
	try {
		let after = parsePicker(await readVisible(params.pane));
		// The picker closing, or the checkbox flipping, is proof it landed.
		if (!after) outcome = 'accepted';
		else if (after.multi) {
			const box = after.options.find((o) => o.index === index);
			if (box?.checked !== wanted.checked) outcome = 'accepted';
		} else if (sameDialog(picker, after) && !picker.axis) {
			// The digit was not a select-and-confirm here. Two dialects do
			// that: a radio dialog moves the highlight and waits for Enter,
			// and pi's dialog ignores digits altogether and wants arrows.
			// Either way it is provably the SAME dialog still open, so more
			// keys cannot land on a later question. (A slider was already
			// driven with arrows and Enter; if it is still open, say so.)
			const highlighted = after.options.find((o) => o.selected)?.index;
			if (highlighted === index) {
				await send(['enter']);
			} else if (highlighted !== undefined) {
				const distance = index - highlighted;
				const arrow = distance >= 0 ? 'down' : 'up';
				await send([...Array(Math.abs(distance)).fill(arrow), 'enter']);
			}
			await settle();
			after = parsePicker(await readVisible(params.pane));
			if (!after || !sameDialog(picker, after)) outcome = 'accepted';
		}
	} catch {
		// screen unreadable — stay honest and report unknown
	}

	return json({ ok: true, chose: wanted.label, outcome });
};
