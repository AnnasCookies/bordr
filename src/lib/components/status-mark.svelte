<script lang="ts">
	import { prefs } from '$lib/prefs.svelte';
	import { STATUS_INK, STATUS_RAIL, STATUS_SYMBOL, STATUS_WORD } from '$lib/theme';

	/**
	 * An agent's status, in whichever form the reader chose — herdr's own
	 * symbols, a dot, or the word.
	 *
	 * Lifted out of the sidebar, which was the only place that honoured the
	 * setting. The conversation header showed the status as a word and nothing
	 * else, so the symbols you picked in settings appeared on one screen.
	 *
	 * `live` is false for a pane with no agent in it — a shell. That is not a
	 * status, so it gets the unknown mark rather than being coloured as idle.
	 */
	let {
		status,
		live = true,
		size = 10
	}: { status: string; live?: boolean; size?: number } = $props();

	const key = $derived(live ? status : 'unknown');
</script>

{#if prefs.value.statusIndicators === 'dot'}
	<span
		class="shrink-0 rounded-full {live ? (STATUS_RAIL[status] ?? 'bg-idle-rail') : 'bg-edge'}"
		style="width:{size * 0.6}px; height:{size * 0.6}px"
		aria-hidden="true"
	></span>
{:else if prefs.value.statusIndicators === 'symbol'}
	<span
		class="shrink-0 text-center font-mono leading-none {STATUS_INK[key] ?? 'text-faint'}"
		style="width:{size}px; font-size:{size}px"
		aria-hidden="true">{STATUS_SYMBOL[key] ?? '·'}</span
	>
{:else}
	<span
		class="shrink-0 truncate font-mono {STATUS_INK[key] ?? 'text-faint'}"
		style="font-size:{size - 0.5}px"
		aria-hidden="true">{STATUS_WORD[key] ?? 'shell'}</span
	>
{/if}
