<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		hint,
		checked,
		onchange,
		preview
	}: {
		label: string;
		hint?: string;
		checked: boolean;
		onchange: (v: boolean) => void;
		/** A live example of what the switch does, shown under the row. */
		preview?: Snippet;
	} = $props();
</script>

<button
	class="flex min-h-11 w-full items-center gap-3 px-3.5 py-3 text-left"
	role="switch"
	aria-checked={checked}
	onclick={() => onchange(!checked)}
>
	<span class="min-w-0 flex-1">
		<span class="block text-[15px]">{label}</span>
		{#if hint}<span class="mt-0.5 block text-[12px] text-muted">{hint}</span>{/if}
	</span>
	<span
		class="relative h-7 w-[46px] shrink-0 rounded-full transition-colors {checked
			? 'bg-done'
			: 'bg-idle-rail'}"
	>
		<span
			class="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left] {checked
				? 'left-[22px]'
				: 'left-0.5'}"
		></span>
	</span>
</button>

{#if preview}
	<div class="px-3.5 pt-0 pb-3">{@render preview()}</div>
{/if}
