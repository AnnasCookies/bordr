/**
 * When a stale page may reload itself instead of asking.
 *
 * Every deploy put up "bordr has updated · tap to reload", and with deploys
 * landing several times a day that tap was most of what the banner was for.
 * It was never automatic because a reload could lose work. Most of that work
 * is persisted now — composer drafts and unacknowledged sends both live in
 * localStorage — so what a reload can still destroy is narrow, and each
 * piece is something the page can say out loud:
 *
 * - a dictation still listening, photos picked but not sent, a send whose
 *   request is in the air (the agent page holds for these);
 * - any request at all still in flight (`netBusy`);
 * - typing into a field nothing saves (a focused editable outside the
 *   composer);
 * - reading back through history, which a reload would snap to the bottom.
 *
 * With none of those, the page reloads when nobody is looking at it — hidden,
 * or untouched for `IDLE_MS`. Otherwise the banner stays, exactly as before.
 */

/** Long enough that a reload never lands mid-glance. */
export const IDLE_MS = 60_000;

export interface ReloadMoment {
	stale: boolean;
	held: boolean;
	busy: boolean;
	typing: boolean;
	hidden: boolean;
	idleMs: number;
}

export function mayReload(moment: ReloadMoment): boolean {
	if (!moment.stale || moment.held || moment.busy || moment.typing) return false;
	return moment.hidden || moment.idleMs >= IDLE_MS;
}

/**
 * An editable element has focus and nothing persists what is typed into it.
 * The composer opts out with `data-draft-saved`: its draft survives a reload.
 */
export function typingUnsaved(active: Element | null): boolean {
	if (!active || !(active instanceof HTMLElement)) return false;
	if (active.closest('[data-draft-saved]')) return false;
	if (active.isContentEditable) return true;
	if (active instanceof HTMLTextAreaElement) return true;
	if (!(active instanceof HTMLInputElement)) return false;
	return !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file'].includes(
		active.type
	);
}

const holds = $state<Record<string, boolean>>({});

/** Mark (or clear) a reason this page must not reload itself right now. */
export function holdReload(reason: string, active: boolean): void {
	if (active) holds[reason] = true;
	else delete holds[reason];
}

export const reloadHolds = {
	get any() {
		return Object.keys(holds).length > 0;
	}
};
