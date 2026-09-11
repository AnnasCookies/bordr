<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { SplitNode } from '$lib/types';
	import Self from './pane-split.svelte';

	/**
	 * A tab's split, drawn the way herdr has it.
	 *
	 * The tree comes from herdr's own layout, so the proportions here are the
	 * terminal's proportions — and a dragged divider calls
	 * `layout.set_split_ratio`, which moves the split in the terminal too. It
	 * is the same split, shown twice, not a picture of one.
	 */
	let {
		node,
		tile,
		onratio
	}: {
		node: SplitNode;
		tile: Snippet<[string]>;
		onratio: (path: boolean[], ratio: number) => void;
	} = $props();

	/**
	 * The ratio while a drag is in flight.
	 *
	 * The server's value keeps arriving every few seconds; without this the
	 * divider would snap back to the last polled ratio mid-drag and fight the
	 * finger. Cleared once herdr's own value catches up.
	 */
	let dragging = $state<number | null>(null);
	let host = $state<HTMLElement | undefined>();

	const ratio = $derived(dragging ?? (node.kind === 'split' ? node.ratio : 0.5));

	/** Neither half may be dragged away to nothing. */
	function clamp(value: number): number {
		return Math.min(Math.max(value, 0.08), 0.92);
	}

	function startDrag(event: PointerEvent) {
		if (node.kind !== 'split' || !host) return;
		event.preventDefault();
		const handle = event.target as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		const box = host.getBoundingClientRect();
		const vertical = node.vertical;
		const path = node.path;

		const move = (e: PointerEvent) => {
			const fraction = vertical
				? (e.clientY - box.top) / box.height
				: (e.clientX - box.left) / box.width;
			dragging = clamp(fraction);
		};
		const stop = (e: PointerEvent) => {
			handle.releasePointerCapture(e.pointerId);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', stop);
			if (dragging !== null) onratio(path, dragging);
			// Held until the next poll carries herdr's value back, so the
			// divider does not jump to the old ratio in the meantime.
			setTimeout(() => (dragging = null), 2500);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', stop);
	}

	function nudge(event: KeyboardEvent) {
		if (node.kind !== 'split') return;
		const back = node.vertical ? 'ArrowUp' : 'ArrowLeft';
		const on = node.vertical ? 'ArrowDown' : 'ArrowRight';
		if (event.key !== back && event.key !== on) return;
		event.preventDefault();
		const next = clamp(ratio + (event.key === on ? 0.05 : -0.05));
		dragging = next;
		onratio(node.path, next);
	}
</script>

{#if node.kind === 'pane'}
	{@render tile(node.paneId)}
{:else}
	<div
		bind:this={host}
		class="flex min-h-0 min-w-0 flex-1 {node.vertical ? 'flex-col' : 'flex-row'}"
	>
		<div class="flex min-h-0 min-w-0" style="flex: {ratio} 1 0">
			<Self node={node.first} {tile} {onratio} />
		</div>
		<!--
			A button, not a separator: svelte-check treats every role="separator"
			as decorative and warns whichever way it is written, and a button is
			announced as the control it actually is.
		-->
		<button
			type="button"
			aria-label="Resize this split, currently {Math.round(ratio * 100)}% — arrow keys adjust"
			class="group relative shrink-0 bg-hairline before:absolute before:content-[''] {node.vertical
				? 'h-1 w-full cursor-row-resize before:inset-x-0 before:-inset-y-2'
				: 'h-full w-1 cursor-col-resize before:-inset-x-2 before:inset-y-0'}"
			onpointerdown={startDrag}
			onkeydown={nudge}
		>
			<span
				class="pointer-events-none absolute rounded-full bg-transparent group-hover:bg-working {node.vertical
					? 'inset-x-0 top-1/2 mx-auto h-[2px] w-8 -translate-y-1/2'
					: 'inset-y-0 left-1/2 my-auto h-8 w-[2px] -translate-x-1/2'}"
			></span>
		</button>
		<div class="flex min-h-0 min-w-0" style="flex: {1 - ratio} 1 0">
			<Self node={node.second} {tile} {onratio} />
		</div>
	</div>
{/if}
