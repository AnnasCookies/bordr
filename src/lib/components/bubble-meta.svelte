<script lang="ts">
	import Ticks from './ticks.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { clockTime } from '$lib/clock-time';

	/**
	 * The time and the delivery mark, for the bottom-right of a sent bubble.
	 *
	 * Both are furniture, so both are quiet: the time inherits the bubble's own
	 * ink at low opacity rather than taking a grey of its own, which on a
	 * saturated fill is the difference between "subtle" and "illegible". The
	 * ticks already colour themselves when they reach `read`.
	 */
	let { at, state }: { at: number; state?: 'sending' | 'sent' | 'read' } = $props();

	const time = $derived(clockTime(at));
</script>

<span class="inline-flex items-center gap-1 align-bottom text-[10.5px] opacity-60">
	{#if time}<span class="font-mono tabular-nums">{time}</span>{/if}
	{#if state && prefs.value.messageTicks}<Ticks {state} size={12} />{/if}
</span>
