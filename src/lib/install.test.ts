import { describe, expect, it } from 'vitest';
import { installOffer, isIOS, SNOOZE_MS, type InstallState } from './install';

const NOW = 1_700_000_000_000;
const base: InstallState = {
	standalone: false,
	hasPrompt: false,
	ios: false,
	dismissedAt: 0,
	now: NOW
};

describe('installOffer', () => {
	it('offers the real dialog when one is in hand', () => {
		expect(installOffer({ ...base, hasPrompt: true })).toBe('prompt');
	});

	it('falls back to the share-sheet hint on iOS', () => {
		expect(installOffer({ ...base, ios: true })).toBe('ios');
	});

	/** A held event beats instructions — iPadOS can in principle do both. */
	it('prefers the real dialog over instructions', () => {
		expect(installOffer({ ...base, hasPrompt: true, ios: true })).toBe('prompt');
	});

	/**
	 * The one that matters most. On iOS no event ever arrives, so `standalone`
	 * is the only thing standing between an installed app and a banner telling
	 * its owner to install it.
	 */
	it('says nothing once it is installed', () => {
		expect(installOffer({ ...base, standalone: true, hasPrompt: true })).toBe('none');
		expect(installOffer({ ...base, standalone: true, ios: true })).toBe('none');
	});

	it('stays quiet for the whole snooze', () => {
		const dismissedAt = NOW - SNOOZE_MS + 1000;
		expect(installOffer({ ...base, hasPrompt: true, dismissedAt })).toBe('none');
	});

	it('comes back once the snooze is up', () => {
		const dismissedAt = NOW - SNOOZE_MS - 1000;
		expect(installOffer({ ...base, hasPrompt: true, dismissedAt })).toBe('prompt');
	});

	/** Firefox, or a Chromium that has decided the site is not installable. */
	it('says nothing when there is no route to offer', () => {
		expect(installOffer(base)).toBe('none');
	});
});

describe('isIOS', () => {
	const IPHONE =
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
	/** iPadOS 13+ reports this — indistinguishable from a Mac but for touch. */
	const IPAD =
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';
	const MAC = IPAD;
	const ANDROID =
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';

	it('knows an iPhone', () => expect(isIOS(IPHONE, 5)).toBe(true));

	it('knows an iPad behind a desktop user agent', () => expect(isIOS(IPAD, 5)).toBe(true));

	/** Same string, no touchscreen. Getting this wrong nags every Mac. */
	it('does not mistake a Mac for an iPad', () => expect(isIOS(MAC, 0)).toBe(false));

	it('is not fooled by Android', () => expect(isIOS(ANDROID, 5)).toBe(false));
});
