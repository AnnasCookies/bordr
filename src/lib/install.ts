/**
 * Whether to offer to install bordr, and which way.
 *
 * Two entirely different mechanics wear the same words. Chromium fires
 * `beforeinstallprompt`, which bordr holds onto so a button of its own can
 * raise the real dialog. Safari fires nothing at all and has no API: the only
 * route is Share → Add to Home Screen, which the person has to do themselves,
 * so all bordr can do is say where it is.
 *
 * Kept apart from the component because "should we be nagging about this" is
 * the part worth being sure about — an install banner that reappears on an
 * installed app, or after it was dismissed, is worse than never offering.
 */

export type InstallOffer =
	/** Say nothing. */
	| 'none'
	/** A held `beforeinstallprompt`: bordr's own button raises the real dialog. */
	| 'prompt'
	/** No API here — show where Add to Home Screen lives. */
	| 'ios';

/**
 * How long a dismissal lasts.
 *
 * Not for ever: someone who said "not now" on a train may well want it later,
 * and an offer that can never come back is one support question away from
 * "how do I install this". Not short either — a banner that returns next week
 * is a banner you learn to swipe away without reading.
 */
export const SNOOZE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export interface InstallState {
	/** Already running as an installed app. */
	standalone: boolean;
	/** A `beforeinstallprompt` event is in hand. */
	hasPrompt: boolean;
	/** iOS or iPadOS, where the only route is the share sheet. */
	ios: boolean;
	/** When the offer was last dismissed; 0 if never. */
	dismissedAt: number;
	now: number;
}

export function installOffer(state: InstallState): InstallOffer {
	// Nothing to install, and on iOS `standalone` is the ONLY signal there is —
	// no event ever arrives to tell us otherwise.
	if (state.standalone) return 'none';
	if (state.dismissedAt > 0 && state.now - state.dismissedAt < SNOOZE_MS) return 'none';
	// The real dialog beats instructions wherever it exists, including on a
	// desktop Chromium where `ios` is false anyway.
	if (state.hasPrompt) return 'prompt';
	if (state.ios) return 'ios';
	// Firefox, and any Chromium that has decided the site is not installable.
	// Silence is right: there is no button to offer and no menu to point at.
	return 'none';
}

/**
 * iOS, including an iPad pretending to be a Mac.
 *
 * iPadOS 13 onwards reports a desktop Safari user agent, so the platform test
 * alone says "Macintosh" and the share-sheet hint never shows on exactly the
 * device that needs it. A touch-capable Mac is the tell; real Macs report
 * `maxTouchPoints` of 0.
 */
export function isIOS(ua: string, maxTouchPoints: number): boolean {
	if (/iPhone|iPad|iPod/.test(ua)) return true;
	return /Macintosh/.test(ua) && maxTouchPoints > 1;
}
