<script lang="ts">
	import { ansiToHtml } from '$lib/ansi';

	/**
	 * A pane you are not in, showing what it is showing.
	 *
	 * The transcript belongs to the focused pane; every other pane in the split
	 * gets its screen, which is the only thing that is true for a shell as well
	 * as an agent. Read at a slow beat — these are the panes you are not
	 * looking at, and a second of staleness on one costs nothing.
	 */
	let {
		paneId,
		lines = 40,
		onopen
	}: { paneId: string; lines?: number; onopen: () => void } = $props();

	let text = $state('');
	let failed = $state(false);

	async function load(id: string) {
		try {
			const res = await fetch(
				`/api/agents/${encodeURIComponent(id)}/read?lines=${lines}&ansi=1&source=visible`
			);
			if (!res.ok) {
				failed = true;
				return;
			}
			text = (await res.json()).text ?? '';
			failed = false;
		} catch {
			// Keep the last screen rather than blanking the tile: a dropped poll
			// is not the pane going away.
			failed = true;
		}
	}

	$effect(() => {
		const id = paneId;
		text = '';
		void load(id);
		const timer = setInterval(() => void load(id), 4000);
		return () => clearInterval(timer);
	});
</script>

<!--
	A button, not a link: opening this pane is a focus change within the same
	tab, and the whole tile is the target.
-->
<button
	type="button"
	class="flex min-h-0 min-w-0 flex-1 cursor-pointer flex-col overflow-hidden bg-card text-left"
	aria-label="Open this pane"
	onclick={onopen}
>
	<div
		class="term min-h-0 w-full flex-1 overflow-hidden p-1.5 text-[10px] leading-[1.35] opacity-80"
	>
		{#if failed && !text}
			<span class="text-faint">no screen</span>
		{:else}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- ansiToHtml escapes -->
			<pre class="whitespace-pre">{@html ansiToHtml(text, true)}</pre>
		{/if}
	</div>
</button>
