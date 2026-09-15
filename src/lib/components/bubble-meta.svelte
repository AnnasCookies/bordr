<script lang="ts">
	import Ticks from './ticks.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { clockTime } from '$lib/clock-time';
	import type { RunPos } from './bubble.svelte';

	/**
	 * The time and delivery mark for a message, whether it uses a bubble or a
	 * plain transcript row.
	 *
	 * Both are furniture, so both are quiet. In a bubble the time inherits its
	 * ink; in a plain row `row` gives it the transcript's faint ink and keeps it
	 * clear of the message text. Ticks colour themselves when they reach `read`.
	 *
	 * `run` is what makes the "once per run" setting work: a burst of five
	 * replies inside the same minute is five identical stamps, so only the last
	 * message in the run carries one. A tick is never grouped that way — it is
	 * about one message each, not about when they happened.
	 */
	let {
		at,
		state,
		run = 'only',
		row = false
	}: {
		at: number;
		state?: 'sending' | 'sent' | 'read';
		run?: RunPos;
		row?: boolean;
	} = $props();

	const showTime = $derived.by(() => {
		if (prefs.value.messageTime === 'off') return false;
		if (prefs.value.messageTime === 'all') return true;
		return run === 'only' || run === 'last';
	});

	const time = $derived(showTime ? clockTime(at, prefs.value.clockFormat) : '');
	const ticks = $derived(state && prefs.value.messageTicks ? state : null);
</script>

{#if time || ticks}
	<span
		class="inline-flex items-center gap-1 align-bottom text-[10.5px] opacity-60 {row
			? 'mt-[3px] shrink-0 text-faint select-none'
			: ''}"
	>
		{#if time}<span class="font-mono tabular-nums">{time}</span>{/if}
		{#if ticks}<Ticks state={ticks} size={12} />{/if}
	</span>
{/if}
