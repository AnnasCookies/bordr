<script lang="ts" module>
	import type { Connection } from './connection-banner.svelte';

	export type NetState = 'offline' | 'navigating' | 'working' | 'stale' | 'down' | 'live';

	/**
	 * One state for "can this app talk to anything right now".
	 *
	 * Ordered by what the person most needs to know. The radio being off beats
	 * every server-side explanation, because nothing else is actionable until
	 * it is back; a request actually in flight beats a stale stream, because
	 * something IS happening and the stale warning would read as a fault.
	 */
	export function netState(online: boolean, connection: Connection, busy: boolean): NetState {
		if (!online) return 'offline';
		if (busy) return connection === 'bordr' || connection === 'silent' ? 'down' : 'working';
		if (connection === 'bordr' || connection === 'silent') return 'down';
		if (connection === 'herdr' || connection === 'incompatible' || connection === 'stale')
			return 'stale';
		return 'live';
	}

	/** What the dot means, for a tooltip and for a screen reader. */
	export function netLabel(state: NetState): string {
		if (state === 'offline') return 'No network';
		if (state === 'working') return 'Loading…';
		if (state === 'down') return 'bordr unreachable';
		if (state === 'stale') return 'Connected, but state may be stale';
		return 'Connected';
	}
</script>

<script lang="ts">
	let { state }: { state: NetState } = $props();

	/**
	 * The connection's own palette, not the agent statuses.
	 *
	 * Both live in the same bar. A green dot for "the stream is fine" beside a
	 * green tick for "the agent finished" is two different facts wearing one
	 * colour, so the link gets teal for healthy and violet for up-but-behind.
	 * Red stays red: it would be perverse to reassign the one colour everybody
	 * already reads correctly.
	 */
	const tone = $derived(
		state === 'offline' || state === 'down'
			? 'bg-danger'
			: state === 'stale'
				? 'bg-net-stale'
				: state === 'working'
					? 'bg-net-live'
					: 'bg-net-live'
	);

	/**
	 * It beats, always, and the beat says which state it is in.
	 *
	 * A living thing is the point: a dot that only moves when something is
	 * wrong is indistinguishable from a dot that has stopped being updated —
	 * which, on a page whose whole problem was a silently dead stream, is the
	 * one thing it must never look like.
	 *
	 * Fast and hard while a request is in flight, urgent while it is down,
	 * slow and shallow when everything is fine.
	 */
	const beat = $derived(
		state === 'working'
			? 'bordr-ping 1s cubic-bezier(0,0,.2,1) infinite'
			: state === 'offline' || state === 'down'
				? 'bordr-ping 1.6s cubic-bezier(0,0,.2,1) infinite'
				: 'bordr-breathe 3.2s ease-in-out infinite'
	);
</script>

<span
	class="relative flex h-1.5 w-1.5 shrink-0"
	title={netLabel(state)}
	role="status"
	aria-label={netLabel(state)}
>
	<!--
		The halo is what makes a tap feel answered on a slow link: the request is
		in flight and the app says so within a frame, long before the response
		lands. It stays for the down states too, where it reads as alarm rather
		than as progress.
	-->
	{#if state === 'working' || state === 'offline' || state === 'down'}
		<span
			class="absolute inline-flex h-full w-full rounded-full opacity-70 motion-reduce:hidden {tone}"
			style="animation: {beat}"
		></span>
	{/if}
	<span
		class="relative inline-flex h-1.5 w-1.5 rounded-full {tone}"
		style={state === 'live' ? `animation: ${beat}` : undefined}
	></span>
</span>
