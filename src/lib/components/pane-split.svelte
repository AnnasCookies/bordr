<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { SplitNode } from '$lib/types';
	import { splitBranchStyles, splitContains } from '$lib/split-sizing';
	import Self from './pane-split.svelte';

	/**
	 * A tab's split, drawn the way herdr has it.
	 *
	 * The tree starts from Herdr's layout. Dividers stay local in compatibility
	 * mode; while Bordr holds the tab viewport lease, Herdr's ratios are canonical
	 * and a drag updates the real shared split.
	 */
	let {
		node,
		active,
		tile,
		canonical = false,
		tabId = ''
	}: {
		node: SplitNode;
		/** The focused live terminal; its siblings fit their useful content. */
		active: string;
		tile: Snippet<[string]>;
		/** Herdr owns the exact ratios while Bordr owns the canonical terminal grid. */
		canonical?: boolean;
		tabId?: string;
	} = $props();

	/**
	 * The local ratio while a drag is in flight and after it lands. It is only
	 * written back to Herdr while the canonical viewport lease is active.
	 */
	let dragging = $state<number | null>(null);
	let manualRatio = $state<number | null>(null);
	/** A deliberate resize wins over auto-fit until this split is remounted or reset. */
	let manual = $state(false);
	let host = $state<HTMLElement | undefined>();

	const ratio = $derived(dragging ?? manualRatio ?? (node.kind === 'split' ? node.ratio : 0.5));
	const sizing = $derived.by(() => {
		if (node.kind !== 'split') return { first: '', second: '', auto: false };
		return splitBranchStyles(
			node.vertical,
			ratio,
			splitContains(node.first, active),
			splitContains(node.second, active),
			manual || canonical
		);
	});

	/** Neither half may be dragged away to nothing. */
	function clamp(value: number): number {
		return Math.min(Math.max(value, 0.08), 0.92);
	}

	async function persistRatio(value: number) {
		if (!canonical || !tabId || node.kind !== 'split') return;
		try {
			await fetch('/api/layout', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ tabId, path: node.path, ratio: value })
			});
		} catch {
			// The local handle remains usable; the layout poll restores Herdr's truth.
		}
	}

	function startDrag(event: PointerEvent) {
		if (node.kind !== 'split' || !host) return;
		event.preventDefault();
		manual = true;
		const handle = event.target as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		const box = host.getBoundingClientRect();
		const vertical = node.vertical;

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
			if (dragging !== null) {
				manualRatio = dragging;
				void persistRatio(dragging);
			}
			dragging = null;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', stop);
	}

	function nudge(event: KeyboardEvent) {
		if (node.kind !== 'split') return;
		if (event.key === 'Home') {
			event.preventDefault();
			manual = false;
			manualRatio = null;
			dragging = null;
			return;
		}
		const back = node.vertical ? 'ArrowUp' : 'ArrowLeft';
		const on = node.vertical ? 'ArrowDown' : 'ArrowRight';
		if (event.key !== back && event.key !== on) return;
		event.preventDefault();
		manual = true;
		const next = clamp(ratio + (event.key === on ? 0.05 : -0.05));
		manualRatio = next;
		void persistRatio(next);
	}
</script>

{#if node.kind === 'pane'}
	{@render tile(node.paneId)}
{:else}
	<div
		bind:this={host}
		class="flex min-h-0 min-w-0 flex-1 {node.vertical ? 'flex-col' : 'flex-row'}"
	>
		<div class="flex min-h-0 min-w-0" style={sizing.first} data-auto-fit={sizing.auto || undefined}>
			<Self node={node.first} {active} {tile} {canonical} {tabId} />
		</div>
		<!--
			A button, not a separator: svelte-check treats every role="separator"
			as decorative and warns whichever way it is written, and a button is
			announced as the control it actually is.
		-->
		<button
			type="button"
			aria-label="Resize this split, currently {Math.round(
				ratio * 100
			)}% — arrow keys adjust; Home restores auto-fit"
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
		<div
			class="flex min-h-0 min-w-0"
			style={sizing.second}
			data-auto-fit={sizing.auto || undefined}
		>
			<Self node={node.second} {active} {tile} {canonical} {tabId} />
		</div>
	</div>
{/if}
