<script lang="ts">
	import type { ControlTarget } from './control-sheet.svelte';

	export type ResourceAction =
		| 'rename'
		| 'swap-focused'
		| 'split-right'
		| 'split-down'
		| 'zoom'
		| 'right-click-pane'
		| 'right-click-herdr'
		| 'close';

	let {
		target,
		x,
		y,
		onchoose,
		onclose
	}: {
		target: ControlTarget;
		x: number;
		y: number;
		onchoose: (action: ResourceAction) => void;
		onclose: () => void;
	} = $props();

	let first = $state<HTMLButtonElement>();

	$effect(() => {
		const button = first;
		if (!button) return;
		const frame = requestAnimationFrame(() => button.focus({ preventScroll: true }));
		return () => cancelAnimationFrame(frame);
	});

	function keydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		onclose();
	}
</script>

<svelte:window onkeydown={keydown} />

<div class="fixed inset-0 z-[60]">
	<button
		type="button"
		class="absolute inset-0 cursor-default"
		aria-label="Close context menu"
		onclick={onclose}
		oncontextmenu={(event) => {
			event.preventDefault();
			onclose();
		}}
	></button>
	<div
		class="fixed w-52 overflow-hidden rounded-lg border border-edge bg-card py-1 shadow-2xl"
		style:left="{x}px"
		style:top="{y}px"
		role="menu"
		tabindex="-1"
		aria-label="{target.scope} options for {target.label || target.id}"
		oncontextmenu={(event) => event.preventDefault()}
	>
		<button
			bind:this={first}
			type="button"
			role="menuitem"
			class="flex min-h-9 w-full items-center px-3 text-left text-[13px] hover:bg-chip focus:bg-chip focus:outline-none"
			onclick={() => onchoose('rename')}
		>
			Rename {target.scope}
		</button>
		{#if target.scope === 'pane'}
			{#if target.canSwap}
				<button
					type="button"
					role="menuitem"
					class="flex min-h-9 w-full items-center px-3 text-left text-[13px] hover:bg-chip focus:bg-chip focus:outline-none"
					onclick={() => onchoose('swap-focused')}
				>
					Swap with focused pane
				</button>
			{/if}
			<button
				type="button"
				role="menuitem"
				class="flex min-h-9 w-full items-center px-3 text-left text-[13px] hover:bg-chip focus:bg-chip focus:outline-none"
				onclick={() => onchoose('split-right')}
			>
				Split right
			</button>
			<button
				type="button"
				role="menuitem"
				class="flex min-h-9 w-full items-center px-3 text-left text-[13px] hover:bg-chip focus:bg-chip focus:outline-none"
				onclick={() => onchoose('split-down')}
			>
				Split down
			</button>
			<button
				type="button"
				role="menuitem"
				class="flex min-h-9 w-full items-center px-3 text-left text-[13px] hover:bg-chip focus:bg-chip focus:outline-none"
				onclick={() => onchoose('zoom')}
			>
				Zoom
			</button>
			<button
				type="button"
				role="menuitem"
				class="flex min-h-9 w-full items-center px-3 text-left text-[13px] hover:bg-chip focus:bg-chip focus:outline-none"
				onclick={() => onchoose('right-click-pane')}
			>
				Send right-clicks to pane
			</button>
			<button
				type="button"
				role="menuitem"
				class="flex min-h-9 w-full items-center px-3 text-left text-[13px] hover:bg-chip focus:bg-chip focus:outline-none"
				onclick={() => onchoose('right-click-herdr')}
			>
				Use Herdr right-click menu
			</button>
		{/if}
		<button
			type="button"
			role="menuitem"
			class="flex min-h-9 w-full items-center border-t border-hairline px-3 text-left text-[13px] text-blocked-ink hover:bg-blocked-bg focus:bg-blocked-bg focus:outline-none"
			onclick={() => onchoose('close')}
		>
			Close {target.scope}
		</button>
	</div>
</div>
