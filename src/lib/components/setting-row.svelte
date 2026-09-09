<script lang="ts" module>
	export interface Segment<T extends string> {
		v: T;
		l: string;
	}
</script>

<script lang="ts" generics="T extends string">
	import type { Snippet } from 'svelte';

	let {
		label,
		options,
		value,
		onchange,
		preview
	}: {
		label: string;
		options: Segment<T>[];
		value: T;
		onchange: (v: T) => void;
		/** A live example of what the current choice does. */
		preview?: Snippet;
	} = $props();
</script>

<div class="px-3.5 py-3">
	<div class="mb-2 text-[15px]">{label}</div>
	<div class="flex gap-0.5 rounded-[9px] bg-chip p-[3px]" role="group" aria-label={label}>
		{#each options as option (option.v)}
			<button
				class="min-h-9 flex-1 rounded-[7px] px-2 text-[13px] {value === option.v
					? 'bg-card text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]'
					: 'text-muted'}"
				aria-pressed={value === option.v}
				onclick={() => onchange(option.v)}
			>
				{option.l}
			</button>
		{/each}
	</div>
	{#if preview}
		<div class="mt-2.5">{@render preview()}</div>
	{/if}
</div>
