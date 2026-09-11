<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';

	/**
	 * The one bar across the top of the app.
	 *
	 * Ordered the way a site nav is ordered — shadcn-svelte's own is the model:
	 * the menu button first, then the brand, then whatever this page has to
	 * say, then the actions pushed to the far end. The brand IS the way home,
	 * which is why there is no back arrow; a ← next to a menu that opens the
	 * very list it goes back to was two controls for one job.
	 */
	let {
		onmenu,
		menuLabel = 'Menu',
		menuExpanded = false,
		middle,
		actions,
		wordmark = 'wide'
	}: {
		onmenu: () => void;
		menuLabel?: string;
		menuExpanded?: boolean;
		middle?: Snippet;
		actions?: Snippet;
		/** 'always' where the bar has no page title of its own to make room for. */
		wordmark?: 'always' | 'wide';
	} = $props();
</script>

<div class="flex items-center gap-2 px-2 py-1.5">
	<button
		class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted"
		aria-label={menuLabel}
		aria-expanded={menuExpanded}
		onclick={onmenu}>☰</button
	>
	<a href={resolve('/')} class="flex shrink-0 items-center gap-2" aria-label="bordr — all agents">
		<img
			src="/patrl-face.png"
			alt=""
			class="h-7 w-7 rounded-full ring-1 ring-black/10 dark:ring-white/15"
			style="image-rendering: pixelated"
		/>
		<!-- The wordmark is the first thing to go when the page has its own title. -->
		<span
			class="text-[15px] font-semibold tracking-[-0.2px] {wordmark === 'always'
				? ''
				: 'hidden sm:inline'}">bordr</span
		>
	</a>

	{#if middle}
		<span class="min-w-0 flex-1">{@render middle()}</span>
	{:else}
		<span class="flex-1"></span>
	{/if}

	{#if actions}
		<span class="flex shrink-0 items-center gap-1">{@render actions()}</span>
	{/if}
</div>
