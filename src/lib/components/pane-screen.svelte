<script module lang="ts">
	import { SvelteMap } from 'svelte/reactivity';

	/** Keep a split preview painted when a structurally identical tree remounts. */
	const screenCache = new SvelteMap<string, string>();

	function remember(paneId: string, text: string) {
		screenCache.delete(paneId);
		screenCache.set(paneId, text);
		if (screenCache.size > 64) screenCache.delete(screenCache.keys().next().value as string);
	}
</script>

<script lang="ts">
	import { ansiToHtml, terminalScreenColumns } from '$lib/ansi';
	import { prefs } from '$lib/prefs.svelte';

	/**
	 * A pane you are not in, showing what it is showing.
	 *
	 * The transcript belongs to the focused pane; every other pane in the split
	 * gets its screen, which is the only thing that is true for a shell as well
	 * as an agent. It uses the same one-second beat and terminal treatment as
	 * the focused terminal, so a split is a set of live surfaces rather than a
	 * conversation beside a dim screenshot.
	 */
	let {
		paneId,
		lines = 40,
		mono = 12,
		onopen
	}: { paneId: string; lines?: number; mono?: number; onopen: () => void } = $props();

	const initialPaneId = () => paneId;
	let text = $state(screenCache.get(initialPaneId()) ?? '');
	let failed = $state(false);
	let shownFor = initialPaneId();
	let tile = $state<HTMLButtonElement | undefined>();
	const tight = $derived(prefs.value.terminalDensity === 'compact');

	/**
	 * A side preview should be as wide as the terminal grid Herdr rendered.
	 * The screen includes right-padding spaces, so its widest row tells us the
	 * real column count even when every visible command is short.
	 */
	function fitGridWidth() {
		const branch = tile?.closest<HTMLElement>('[data-auto-fit="true"]');
		const split = branch?.parentElement;
		const pre = tile?.querySelector('pre');
		if (!branch || !split || !pre || getComputedStyle(split).flexDirection !== 'row') return;
		const columns = terminalScreenColumns(text);
		if (!columns) return;
		const style = getComputedStyle(pre);
		const boxStyle = getComputedStyle(pre.parentElement as HTMLElement);
		const context = document.createElement('canvas').getContext('2d');
		if (context) context.font = style.font;
		const cell = context?.measureText('0').width || Number.parseFloat(style.fontSize) * 0.6;
		const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
		const padding =
			Number.parseFloat(boxStyle.paddingLeft) + Number.parseFloat(boxStyle.paddingRight);
		const wanted = Math.max(root * 14, Math.ceil(columns * cell + padding));
		const basis = `${wanted}px`;
		branch.dataset.terminalColumns = String(columns);
		if (branch.style.flexBasis !== basis) branch.style.flexBasis = basis;
	}

	$effect(() => {
		void text;
		const element = tile;
		if (!element) return;
		const frame = requestAnimationFrame(fitGridWidth);
		return () => cancelAnimationFrame(frame);
	});

	$effect(() => {
		const branch = tile?.closest<HTMLElement>('[data-auto-fit], [data-terminal-columns]');
		if (!branch) return;
		const observer = new ResizeObserver(fitGridWidth);
		observer.observe(branch);
		return () => observer.disconnect();
	});

	$effect(() => {
		const id = paneId;
		if (id !== shownFor) {
			shownFor = id;
			text = screenCache.get(id) ?? '';
		}
		let live = true;
		let pending = false;
		const load = async () => {
			// A slow read must not overtake the next poll and repaint an older screen.
			if (pending) return;
			pending = true;
			try {
				const res = await fetch(
					`/api/agents/${encodeURIComponent(id)}/read?lines=${lines}&ansi=1&source=visible`
				);
				if (!res.ok) {
					if (live) failed = true;
					return;
				}
				const next = (await res.json()).text ?? '';
				if (!live) return;
				if (next !== text) {
					text = next;
					remember(id, next);
				}
				failed = false;
			} catch {
				// Keep the last screen rather than blanking the tile: a dropped poll
				// is not the pane going away.
				if (live) failed = true;
			} finally {
				pending = false;
			}
		};
		void load();
		const timer = setInterval(() => void load(), 1000);
		return () => {
			live = false;
			clearInterval(timer);
		};
	});
</script>

<!--
	A button, not a link: opening this pane is a focus change within the same
	tab, and the whole tile is the target.
-->
<button
	bind:this={tile}
	type="button"
	class="flex min-h-0 min-w-0 flex-1 cursor-pointer flex-col overflow-hidden bg-page text-left"
	aria-label="Open this pane"
	onclick={onopen}
>
	<div
		class="term flex min-h-0 w-full flex-1 flex-col justify-end overflow-auto {tight
			? 'px-1.5 py-0.5 leading-[1.15]'
			: 'px-3 py-2 leading-[1.35]'}"
		style="font-size: {mono}px"
	>
		{#if failed && !text}
			<span class="text-faint">no screen</span>
		{:else}
			<!-- The branch follows Herdr's source column count. pre-wrap is only the
			     fallback when 35% of the viewport cannot hold that grid. -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- ansiToHtml escapes -->
			<pre class="[overflow-wrap:normal] whitespace-pre-wrap">{@html ansiToHtml(text, true)}</pre>
		{/if}
	</div>
</button>
