/**
 * When an unacknowledged prompt should stop being shown.
 *
 * A prompt you send is echoed straight away as its own bubble, and retired
 * once the transcript proves the agent took it. Something has to retire the
 * ones the transcript never shows, or a prompt the harness dropped sits there
 * saying "queued" for the rest of the session.
 *
 * The rule that lost messages: it also reaped prompts whose REQUEST had not
 * come back yet. On a slow link a send can take longer than the grace period,
 * so the bubble vanished while the POST was still in the air — "stuck
 * sending, then it disappears". A request in flight has not been offered to
 * the agent and refused; it has not been offered at all.
 */

export interface PendingSend {
	id: number;
	text: string;
	at: number;
	/** Request lifecycle; accepted commands carry a browser-visible receipt. */
	state?: 'sending' | 'queued' | 'accepted';
	/** Slash-command word, without `/`, when this is terminal UI control. */
	command?: string;
	/** Honest server result: confirmed where Pi exposes one, accepted otherwise. */
	receipt?: string;
	/**
	 * The question this was an answer to, when it was one.
	 *
	 * An answer on its own is a fragment — "Rows shift when statuses change"
	 * means nothing three screens later, and the card it came from is gone by
	 * then on purpose. The bubble carries its question so the exchange reads
	 * as an exchange.
	 */
	question?: string;
	/**
	 * When herdr took it. The grace period runs from HERE, not from when you
	 * pressed send: it exists to let the transcript catch up with a delivery,
	 * so a slow send that took most of it would otherwise eat its own grace
	 * and the bubble would vanish the moment it was finally delivered.
	 */
	deliveredAt?: number;
}

/** Whitespace is not meaning: a harness may rewrap what it was given. */
export function say(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/**
 * Has this prompt turned up in the transcript?
 *
 * `startsWith` as well as equality, because a harness can append to what it
 * was given — a hook adds context, a wrapper adds a preamble — and the prompt
 * is still the prompt.
 */
export function landedIn(text: string, landed: string[]): boolean {
	const mine = say(text);
	return mine !== '' && landed.some((l) => l === mine || l.startsWith(mine));
}

/**
 * Enough of a prompt to recognise it on a terminal screen.
 *
 * A harness shows a prompt it has taken but not started — Claude Code parks
 * it under the composer — so the pane's own screen answers "has the agent got
 * this?" long before the transcript does. The transcript is only written when
 * the turn STARTS, which behind a long turn is minutes away, and that gap is
 * what made a delivered message look stuck.
 *
 * A prefix rather than the whole thing, because the screen wraps: whitespace
 * is normalised on both sides so a wrap at a space matches, and only the head
 * is compared so a wrap further in cannot break it.
 *
 * ponytail: a mid-WORD wrap in the first 60 characters would still miss, and
 * the message simply stays on one tick until the transcript catches up —
 * which is the old behaviour, so the failure mode is the previous correct
 * answer rather than a wrong one.
 */
const SCREEN_PROBE = 60;

/**
 * Short prompts are not matched. "ok" or "yes" would be found somewhere on
 * almost any screen, and a false two ticks is worse than a slow one: it would
 * say the agent has something it has never seen.
 */
const SCREEN_MIN = 8;

/** Is this prompt visible on the pane's screen — queued, or being worked on? */
export function onScreen(text: string, screen: string): boolean {
	const mine = say(text).slice(0, SCREEN_PROBE);
	if (mine.length < SCREEN_MIN) return false;
	return say(screen).includes(mine);
}

/** How long after the agent settles an undelivered prompt is given up on. */
export const GRACE_MS = 20_000;

/**
 * The prompts still worth showing.
 *
 * `settled` means the agent is idle or done: a prompt it has taken would be
 * in the transcript by now, and one it has not is never going to be.
 */
export function keepPending(
	pending: PendingSend[],
	landed: string[],
	settled: boolean,
	now: number
): PendingSend[] {
	return pending.filter((p) => {
		// Still in the air. Nothing has been decided about it yet, and the
		// request's own success or failure is what will decide.
		if (p.state === 'sending') return true;
		if (landedIn(p.text, landed)) return false;
		return !(settled && now - (p.deliveredAt ?? p.at) > GRACE_MS);
	});
}
