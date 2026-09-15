/**
 * The pieces of the notification path that are worth being sure about.
 *
 * Both ends of it run somewhere a test cannot easily reach — one in a service
 * worker, one behind a push service — and headless Chromium will not grant
 * notification permission at all, so the browser cannot check them either.
 * What can be checked is the logic, so the logic lives here.
 */

/** A picker option, as much of one as a notification needs. */
export interface Choice {
	index: number;
	label: string;
}

/** Android shows two action buttons; the rest would be built and thrown away. */
export const MAX_ACTIONS = 2;

/** Action buttons carry the chosen index in their id: `opt:2`. */
export const ACTION_PREFIX = 'opt:';

/** A tray gives a button a few words, not a sentence. */
export const MAX_LABEL = 28;

/**
 * One picker option as a notification button.
 *
 * The ellipsis is the point of clipping here rather than letting the tray do
 * it: a label cut mid-word with no mark reads as the whole option, and the
 * whole option is what you are about to agree to.
 */
export function actionFor(choice: Choice): { action: string; title: string } {
	return {
		action: `${ACTION_PREFIX}${choice.index}`,
		title:
			choice.label.length > MAX_LABEL ? `${choice.label.slice(0, MAX_LABEL - 1)}…` : choice.label
	};
}

/**
 * The index an action id refers to, or null when it is not an answer.
 *
 * Null and not a number for the ordinary tap, which has no action at all and
 * means "open the agent" — a zero there would answer the first option by
 * accident.
 */
export function chosenIndex(action: string | undefined): number | null {
	if (!action?.startsWith(ACTION_PREFIX)) return null;
	const raw = action.slice(ACTION_PREFIX.length);
	// Digits, not `Number()`: `Number('')` is 0, so a truncated `opt:` would
	// have answered option zero — a keystroke sent to a terminal by a malformed
	// id. Caught by the test for exactly that, which is why it is there.
	if (!/^\d+$/.test(raw)) return null;
	return Number(raw);
}

/**
 * Which choices may be offered as buttons.
 *
 * A multi-select needs several taps and a confirm, which a tray cannot
 * express — one button for it would answer something other than what it says.
 */
export function offerable(options: Choice[], multi: boolean): Choice[] {
	return multi ? [] : options.slice(0, MAX_ACTIONS);
}
