import { describe, expect, it } from 'vitest';
import { connectionText, type Connection } from './components/connection-banner.svelte';

describe('connectionText', () => {
	/**
	 * The whole point of the `reconnecting` state: a stream that drops and
	 * recovers within a few seconds is ordinary, and a banner for it reads as a
	 * fault. Only a sustained outage becomes `bordr`.
	 */
	it('says nothing while a reconnect is in flight', () => {
		expect(connectionText('reconnecting')).toBeNull();
		expect(connectionText('live')).toBeNull();
	});

	it('names every real fault', () => {
		const faults: Connection[] = ['bordr', 'herdr', 'incompatible', 'stale', 'silent'];
		for (const fault of faults) {
			expect(connectionText(fault), fault).toBeTruthy();
		}
	});

	/** A stream that never delivers is most often a proxy buffering it; say so. */
	it('points a never-delivering stream at proxy buffering', () => {
		expect(connectionText('silent')).toContain('/api/events');
	});
});
