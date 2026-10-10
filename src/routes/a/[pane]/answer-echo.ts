/**
 * What tapping one option of an on-screen picker should leave on the page.
 *
 * A single-select answer is a turn you took: it becomes a "sent" bubble, and
 * once the server confirms the menu moved the card is held off screen until
 * the next read catches up, so it does not come back looking unanswered.
 *
 * A checkbox is not an answer. Ticking one flips a box and the question stays
 * open — the server calls that `accepted` too, because the box provably
 * changed. Treating it like a single-select answer hid the card and its
 * Submit button for the whole hold after the FIRST tick, and put "Red" on
 * screen as though it had been sent, in the middle of choosing. So a
 * multi-select picker is never echoed and never held; Submit is what ends it.
 */

interface OnScreenPicker {
	multi: boolean;
}

/** Whether tapping an option is echoed as a message you sent. */
export function echoesAnswer(picker: OnScreenPicker | null | undefined): boolean {
	return picker?.multi !== true;
}

/**
 * Whether a successful answer retires the card for the answered hold.
 *
 * Only on `accepted`: `unknown` is exactly the case where the reader needs
 * to look at the card, and a reply that carries no outcome confirmed nothing.
 */
export function holdsAnswer(
	picker: OnScreenPicker | null | undefined,
	outcome: string | undefined
): boolean {
	return echoesAnswer(picker) && outcome === 'accepted';
}

/**
 * Whether the question card stays off screen.
 *
 * Two reasons, kept apart because they end differently. `sendingKey` is set the
 * instant an option is tapped and cleared when the server replies, so on a slow
 * link the card goes at once instead of sitting untouched for the whole round
 * trip; a refusal or an unconfirmed send then brings it back. `answeredKey` is
 * the hold after the server CONFIRMED the menu moved. Both are matched on the
 * question, so the next question is never swallowed.
 */
export function cardHeld(
	state: {
		paneId: string;
		scope: string;
		pickerKey: string;
		sendingScope: string;
		sendingPaneId: string;
		sendingKey: string;
		answeredPaneId: string;
		answeredScope: string;
		answeredKey: string;
		answeredAt: number;
		now: number;
	},
	holdMs: number
): boolean {
	if (
		state.sendingScope === state.scope &&
		state.sendingPaneId === state.paneId &&
		state.sendingKey !== '' &&
		state.sendingKey === state.pickerKey
	)
		return true;
	return (
		state.answeredScope === state.scope &&
		state.answeredPaneId === state.paneId &&
		state.answeredKey !== '' &&
		state.answeredKey === state.pickerKey &&
		state.now - state.answeredAt < holdMs
	);
}
