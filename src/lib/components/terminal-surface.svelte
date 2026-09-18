<script lang="ts">
	import { ansiToHtml } from '$lib/ansi';
	import { prefs } from '$lib/prefs.svelte';
	import { termGrid } from '$lib/term-grid';

	/**
	 * The terminal's painted screen, shared by focused and sibling panes.
	 *
	 * Input controls belong to PaneTerminal and navigation belongs to PaneScreen;
	 * this component owns the bit that must not drift between them: fitting,
	 * wrapping, density, padding, colour and bottom-following scroll behaviour.
	 */
	let {
		text,
		mono = 12,
		failed = false,
		empty = 'no screen'
	}: { text: string; mono?: number; failed?: boolean; empty?: string } = $props();

	const FLOOR = 8;
	let screen = $state<HTMLElement | undefined>();
	let stuck = $state(true);
	let fitted = $state(0);
	const mode = $derived(prefs.value.terminalFit);
	const tight = $derived(prefs.value.terminalDensity === 'compact');
	const size = $derived(mode === 'fit' ? fitted || mono : mono);

	function fit() {
		if (mode !== 'fit') {
			fitted = 0;
			return;
		}
		const box = screen;
		const pre = box?.querySelector('pre');
		if (!box || !pre || !box.clientWidth) return;
		// Measure at the source size so each result is independent of the previous fit.
		const at = fitted || mono;
		const natural = (pre.scrollWidth / at) * mono;
		if (!natural) return;
		const want = Math.min(mono, (box.clientWidth / natural) * mono);
		fitted = Math.max(FLOOR, Math.floor(want * 10) / 10);
	}

	$effect(() => {
		void text;
		void mono;
		void mode;
		const frame = requestAnimationFrame(fit);
		return () => cancelAnimationFrame(frame);
	});

	$effect(() => {
		const box = screen;
		if (!box) return;
		const observer = new ResizeObserver(fit);
		observer.observe(box);
		return () => observer.disconnect();
	});

	$effect(() => {
		void text;
		if (stuck && screen) screen.scrollTop = screen.scrollHeight;
	});
</script>

<div
	bind:this={screen}
	use:termGrid
	onscroll={() => {
		if (screen) stuck = screen.scrollTop + screen.clientHeight >= screen.scrollHeight - 24;
	}}
	class="term flex min-h-0 w-full flex-1 flex-col justify-end overflow-auto {tight
		? 'px-1.5 py-0.5 leading-[1.15]'
		: 'px-3 py-2 leading-[1.35]'}"
	style="font-size: {size}px"
>
	{#if failed && !text}
		<span class="text-faint">{empty}</span>
	{:else}
		<!-- eslint-disable svelte/no-at-html-tags -- ansiToHtml escapes its input -->
		<pre
			class={mode === 'wrap'
				? '[overflow-wrap:anywhere] whitespace-pre-wrap'
				: 'whitespace-pre'}>{@html ansiToHtml(text, true)}</pre>
		<!-- eslint-enable svelte/no-at-html-tags -->
	{/if}
</div>

<style>
	.term {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace;
		font-variant-ligatures: none;
	}

	.term :global(.tc) {
		display: inline-block;
		width: var(--cell, 1ch);
		text-align: center;
		overflow: hidden;
	}

	.term :global(.tc-w) {
		width: calc(var(--cell, 1ch) * 2);
	}
</style>
