import { afterEach, describe, expect, it } from 'vitest';
import { installCapture } from './install-event.svelte';

function installEvent(): Event {
	return new Event('beforeinstallprompt', { cancelable: true });
}

describe('installCapture', () => {
	let stop: (() => void) | null = null;

	afterEach(() => {
		stop?.();
		stop = null;
		installCapture.spend();
	});

	/**
	 * The event fires once per page load, often before the banner exists. It
	 * has to be held where the banner can find it later, and the browser's own
	 * infobar has to be suppressed at the moment it arrives.
	 */
	it('holds the event and suppresses the browser infobar', () => {
		const target = new EventTarget();
		stop = installCapture.listen(target);
		const event = installEvent();
		target.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(installCapture.held).toBe(event);
	});

	/** Leaving `/` and coming back must not lose an event already caught. */
	it('keeps the event whether or not anything is reading it', () => {
		const target = new EventTarget();
		stop = installCapture.listen(target);
		const event = installEvent();
		target.dispatchEvent(event);
		expect(installCapture.held).toBe(event);
		expect(installCapture.held).toBe(event);
	});

	it('listens once however many times it is registered', () => {
		const target = new EventTarget();
		let calls = 0;
		const event = installEvent();
		const original = event.preventDefault.bind(event);
		event.preventDefault = () => {
			calls += 1;
			original();
		};
		stop = installCapture.listen(target);
		installCapture.listen(target);
		target.dispatchEvent(event);
		expect(calls).toBe(1);
	});

	it('drops the event once the app is installed', () => {
		const target = new EventTarget();
		stop = installCapture.listen(target);
		target.dispatchEvent(installEvent());
		target.dispatchEvent(new Event('appinstalled'));
		expect(installCapture.held).toBeNull();
		expect(installCapture.installed).toBe(true);
	});

	it('stops listening when torn down', () => {
		const target = new EventTarget();
		installCapture.listen(target)();
		target.dispatchEvent(installEvent());
		expect(installCapture.held).toBeNull();
	});
});
