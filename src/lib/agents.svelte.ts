import type { AgentSummary } from '$lib/types';
import type { Connection } from '$lib/components/connection-banner.svelte';

export interface CompatInfo {
	level: string;
	message: string | null;
	version?: string | null;
	protocol?: number | null;
	session?: string;
}

export function createAgentStore() {
	let agents = $state<AgentSummary[]>([]);
	let read = $state<Record<string, number>>({});
	let compat = $state<CompatInfo | null>(null);
	let lastSeen = $state(0);
	let connected = $state(false);
	/**
	 * A ticking clock for the stale check. `Date.now()` read inside a getter
	 * is not reactive, so without this the 'stale' state could only be seen
	 * if something else happened to re-read the getter.
	 */
	let now = $state(Date.now());
	let clock: ReturnType<typeof setInterval> | undefined;
	const CLOCK_MS = 5000;
	/**
	 * A dropped stream is only worth reporting once it stays dropped. Reconnects
	 * take a moment, and announcing each one as "bordr unreachable" made a
	 * recovered blip look like a fault.
	 */
	let sustained = $state(false);
	/**
	 * Nothing — not even the first snapshot — ever arrived. That is a
	 * different fault from losing a stream that was working: most often a
	 * reverse proxy buffering the response.
	 */
	let silent = $state(false);
	let graceTimer: ReturnType<typeof setTimeout> | undefined;
	const GRACE_MS = 4000;
	let source: EventSource | undefined;
	let retry: ReturnType<typeof setTimeout> | undefined;
	let backoff = 1000;
	let stopped = false;

	function armGrace() {
		if (graceTimer) return;
		graceTimer = setTimeout(() => {
			sustained = true;
			// Only a 200 stream that delivers nothing is the buffering-proxy
			// signature; a stream that errored is bordr being unreachable.
			silent = lastSeen === 0 && source?.readyState === EventSource.OPEN;
			graceTimer = undefined;
		}, GRACE_MS);
	}

	/** Any event proves the stream is alive, even when nothing changed. */
	function heard() {
		connected = true;
		sustained = false;
		silent = false;
		clearTimeout(graceTimer);
		graceTimer = undefined;
		lastSeen = Date.now();
		now = lastSeen;
	}

	/**
	 * EventSource only auto-retries transport errors. A non-200 response —
	 * exactly what tailscale serve returns while bordr restarts — closes it
	 * permanently, leaving the phone showing frozen state that looks live.
	 * So own the reconnect: reopen with backoff whenever it closes.
	 */
	function open() {
		if (stopped) return;
		source?.close();
		source = new EventSource('/api/events');
		// The server sends a snapshot on connect, so silence past the grace
		// window is a fault, not a slow start.
		armGrace();
		source.addEventListener('agents', (e) => {
			agents = JSON.parse((e as MessageEvent).data) as AgentSummary[];
			heard();
			backoff = 1000;
		});
		source.addEventListener('ping', heard);
		source.addEventListener('read', (e) => {
			read = JSON.parse((e as MessageEvent).data) as Record<string, number>;
			heard();
		});
		source.addEventListener('compat', (e) => {
			compat = JSON.parse((e as MessageEvent).data) as CompatInfo;
			heard();
		});
		source.onerror = () => {
			connected = false;
			armGrace();
			if (source?.readyState !== EventSource.CLOSED) return; // its own retry
			clearTimeout(retry);
			retry = setTimeout(open, backoff);
			backoff = Math.min(backoff * 2, 30_000);
		};
	}

	function onVisible() {
		if (document.visibilityState !== 'visible') return;
		// A phone that slept can hold a half-open socket that never errors and
		// never delivers, and `connected` stays true for it. Age is the tell.
		if (!connected || Date.now() - lastSeen > 10_000) open();
	}

	return {
		get agents() {
			return agents;
		},
		get read() {
			return read;
		},
		get compat() {
			return compat;
		},
		/**
		 * What is actually wrong, rather than a single "reconnecting".
		 * 'bordr' means this app is unreachable (restarting behind the proxy);
		 * 'herdr' means bordr is fine but the thing it reads is not — very
		 * different fixes, and previously indistinguishable.
		 */
		get connection(): Connection {
			// 'reconnecting' is deliberately quiet in the UI: it is the ordinary
			// case, not a fault, and only becomes 'bordr' if it does not recover.
			if (!connected) return silent ? 'silent' : sustained ? 'bordr' : 'reconnecting';
			if (compat?.level === 'unreachable') return 'herdr';
			if (compat?.level === 'incompatible') return 'incompatible';
			// A live stream that has gone quiet past two heartbeats is not
			// trustworthy even though the socket is open.
			if (lastSeen && now - lastSeen > 50_000) return 'stale';
			return 'live';
		},
		get connected() {
			return connected;
		},
		/** Epoch ms of the last SSE event — the Connection screen shows its age. */
		get lastSeen() {
			return lastSeen;
		},
		start() {
			stopped = false;
			open();
			// A phone that slept can hold a half-open connection that never
			// errors — re-check whenever the tab becomes visible again.
			document.addEventListener('visibilitychange', onVisible);
			clearInterval(clock);
			clock = setInterval(() => (now = Date.now()), CLOCK_MS);
		},
		stop() {
			stopped = true;
			clearTimeout(retry);
			clearTimeout(graceTimer);
			graceTimer = undefined;
			clearInterval(clock);
			clock = undefined;
			document.removeEventListener('visibilitychange', onVisible);
			source?.close();
			source = undefined;
		}
	};
}

/**
 * One stream for the whole session.
 *
 * Each page used to build its own store, so every client-side navigation tore
 * the EventSource down and reopened it — measured at 185ms before the agent
 * list was populated again. For the conversation view that window is dead
 * swipe: the order it navigates by was empty, so a quick swipe did nothing and
 * looked like the order was being ignored.
 *
 * Reference counted with a grace period, because during a navigation the
 * incoming page may mount before the outgoing one is destroyed, and the count
 * can legitimately touch zero in between.
 */
const shared = createAgentStore();
let holders = 0;
let closing: ReturnType<typeof setTimeout> | undefined;
const GRACE_MS = 2000;

export const agentStore = {
	// Getters are delegated, never spread: `{...shared}` would read each one
	// once and copy the value, freezing the list at whatever it held.
	get agents() {
		return shared.agents;
	},
	get read() {
		return shared.read;
	},
	get compat() {
		return shared.compat;
	},
	get connection() {
		return shared.connection;
	},
	get connected() {
		return shared.connected;
	},
	get lastSeen() {
		return shared.lastSeen;
	},
	start() {
		holders += 1;
		clearTimeout(closing);
		closing = undefined;
		shared.start();
	},
	stop() {
		holders = Math.max(0, holders - 1);
		if (holders > 0) return;
		clearTimeout(closing);
		closing = setTimeout(() => {
			if (holders === 0) shared.stop();
		}, GRACE_MS);
	}
};
