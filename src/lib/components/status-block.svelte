<script lang="ts">
	import { ansiToHtml } from '$lib/ansi';
	import { prefs } from '$lib/prefs.svelte';

	let {
		rows,
		agent,
		open = false,
		ontoggle
	}: {
		/** Status rows carrying their terminal colour. */
		rows: string[];
		/** Harness kind, so the chosen row is remembered per harness. */
		agent: string;
		open?: boolean;
		ontoggle: () => void;
	} = $props();

	/**
	 * Which row shows when the block is collapsed.
	 *
	 * A harness prints several — context, quotas, spend — and which one
	 * matters is a per-harness habit, not a global one. Chosen by scrolling
	 * the collapsed strip: it snaps to a row, and that row is remembered.
	 */
	const chosen = $derived(
		Math.min(prefs.value.statusLine[agent] ?? 0, Math.max(0, rows.length - 1))
	);

	let strip = $state<HTMLDivElement | undefined>();

	/** Whichever row the strip has settled on becomes the chosen one. */
	function onScroll() {
		if (!strip || rows.length < 2) return;
		const height = strip.clientHeight || 1;
		const index = Math.round(strip.scrollTop / height);
		if (index !== chosen && index >= 0 && index < rows.length) {
			prefs.set('statusLine', { ...prefs.value.statusLine, [agent]: index });
		}
	}

	// Scroll the strip to the remembered row when the pane or the rows change.
	$effect(() => {
		const el = strip;
		const target = chosen;
		void rows.length;
		if (!el) return;
		const top = target * (el.clientHeight || 0);
		if (Math.abs(el.scrollTop - top) > 2) el.scrollTop = top;
	});
</script>

<!-- eslint-disable svelte/no-at-html-tags -->
<div class="flex items-center gap-1 px-4 pb-1.5 font-mono text-[10px] text-muted">
	{#if open}
		<button class="min-w-0 flex-1 text-left whitespace-pre-wrap" onclick={ontoggle}>
			{#each rows as row, i (i)}{@html (i > 0 ? '\n' : '') + ansiToHtml(row)}{/each}
		</button>
		<button class="shrink-0 self-start" aria-label="Collapse status" onclick={ontoggle}>▴</button>
	{:else}
		<!--
			A one-row window over the rows, snapping. Scrolling it picks the row
			you want to see at a glance; tapping opens the lot.
		-->
		<div
			bind:this={strip}
			onscroll={onScroll}
			class="strip min-w-0 flex-1"
			role="group"
			aria-label="Status lines"
		>
			{#each rows as row, i (i)}
				<button class="row w-full truncate text-left" onclick={ontoggle}
					>{@html ansiToHtml(row)}</button
				>
			{/each}
		</div>
		<span class="shrink-0 text-faint" aria-hidden="true"
			>{rows.length > 1 ? `${chosen + 1}/${rows.length}` : ''}</span
		>
		<button class="shrink-0" aria-label="Expand status" onclick={ontoggle}>▾</button>
	{/if}
</div>

<style>
	.strip {
		/* One row tall, snapping so a flick lands on a line rather than
		   between two. */
		height: 1.35em;
		overflow-y: auto;
		scroll-snap-type: y mandatory;
		scrollbar-width: none;
		overscroll-behavior: contain;
	}
	.strip::-webkit-scrollbar {
		display: none;
	}
	.row {
		height: 1.35em;
		line-height: 1.35em;
		scroll-snap-align: start;
	}
</style>
