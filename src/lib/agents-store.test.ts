import { afterEach, expect, it, vi } from 'vitest';
import { createAgentStore } from './agents.svelte';

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
it('gives a watchdog replacement a full connection deadline', () => {
	vi.useFakeTimers();
	vi.setSystemTime(1000);
	class Source extends EventTarget {
		static OPEN = 1;
		static CLOSED = 2;
		readyState = 1;
		onerror = null;
		close = vi.fn();
		constructor() {
			super();
			sources.push(this);
		}
	}
	const sources: Source[] = [];
	vi.stubGlobal('EventSource', Source);
	vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
	vi.stubGlobal('addEventListener', vi.fn());
	vi.stubGlobal('removeEventListener', vi.fn());
	const store = createAgentStore();
	store.start();
	sources[0].dispatchEvent(new Event('ping'));
	vi.advanceTimersByTime(25_000);
	expect(sources).toHaveLength(2);
	vi.advanceTimersByTime(10_000);
	expect(sources).toHaveLength(2);
	sources[1].dispatchEvent(new Event('ping'));
	expect(store.connected).toBe(true);
	expect(sources[1].close).not.toHaveBeenCalled();
	store.stop();
});
