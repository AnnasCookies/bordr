import { describe, expect, it } from 'vitest';
import { netLabel, netState } from './components/net-status.svelte';

describe('netState', () => {
	it('puts the radio being off above every server-side explanation', () => {
		// Nothing else is actionable until it comes back, and "bordr
		// unreachable" is a misleading thing to say about a phone in a lift.
		expect(netState(false, 'live', false)).toBe('offline');
		expect(netState(false, 'bordr', true)).toBe('offline');
	});

	it('shows work in flight ahead of a stale stream', () => {
		// Something IS happening; a staleness warning would read as a fault.
		expect(netState(true, 'stale', true)).toBe('working');
		expect(netState(true, 'live', true)).toBe('working');
	});

	it('still says down when the server is gone, even mid-request', () => {
		// A request in flight against an unreachable server is not progress.
		expect(netState(true, 'bordr', true)).toBe('down');
		expect(netState(true, 'silent', true)).toBe('down');
	});

	it('treats a reconnect as live, not as a fault', () => {
		// A stream that drops and recovers is the ordinary case on a phone.
		expect(netState(true, 'reconnecting', false)).toBe('live');
	});

	it('flags the states where bordr is up but what it reads is not', () => {
		for (const c of ['herdr', 'incompatible', 'stale'] as const) {
			expect(netState(true, c, false), c).toBe('stale');
		}
	});

	it('is live when everything is', () => {
		expect(netState(true, 'live', false)).toBe('live');
	});

	it('has words for every state', () => {
		for (const s of ['offline', 'working', 'down', 'stale', 'live'] as const) {
			expect(netLabel(s), s).toBeTruthy();
		}
	});
});
