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
		actions
	}: {
		onmenu: () => void;
		menuLabel?: string;
		menuExpanded?: boolean;
		middle?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<div class="flex items-center gap-2 px-2 py-1.5">
	<button
		class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted"
		aria-label={menuLabel}
		aria-expanded={menuExpanded}
		onclick={onmenu}>☰</button
	>
	<!--
		The mark alone. The name is on the tab, the manifest and the address bar
		already, and next to a pane's own title it was the least useful word on
		the screen — so it only speaks when spoken to.
	-->
	<a
		href={resolve('/')}
		class="group relative flex shrink-0 items-center"
		aria-label="bordr — all agents"
	>
		<img
			src="/patrl-face.png"
			alt=""
			class="h-7 w-7 rounded-full ring-1 ring-black/10 dark:ring-white/15"
			style="image-rendering: pixelated"
		/>
		<span
			class="pointer-events-none absolute top-full left-1/2 z-20 mt-1.5 -translate-x-1/2 rounded-lg bg-ink px-2 py-1 text-[11px] font-medium whitespace-nowrap text-card opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
			aria-hidden="true"
		>
			<!-- The bubble's tail, drawn as a rotated corner of the bubble itself. -->
			<span class="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-ink"></span>
			woof
		</span>
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
