<script lang="ts">
	import { contrastRatio, meetsAA } from '$lib/contrast';

	let {
		label,
		background,
		text,
		onbackground,
		ontext
	}: {
		label: string;
		background: string;
		text: string;
		onbackground: (v: string) => void;
		ontext: (v: string) => void;
	} = $props();

	const ratio = $derived(contrastRatio(background, text));
	const readable = $derived(meetsAA(background, text));
</script>

<div class="px-3.5 py-3">
	<div class="mb-2 flex items-center gap-2">
		<span class="flex-1 text-[15px]">{label}</span>
		<!-- The preview is the real thing: same radius and padding as a bubble. -->
		<span
			class="rounded-2xl rounded-br-sm px-3 py-1 text-[13px]"
			style="background:{background}; color:{text}">Aa</span
		>
	</div>
	<div class="flex items-center gap-3">
		<label class="flex flex-1 items-center gap-2 text-[13px] text-muted">
			<input
				type="color"
				value={background}
				oninput={(e) => onbackground((e.currentTarget as HTMLInputElement).value)}
				class="h-8 w-10 shrink-0 rounded border border-edge bg-transparent"
				aria-label="{label} bubble colour"
			/>
			bubble
		</label>
		<label class="flex flex-1 items-center gap-2 text-[13px] text-muted">
			<input
				type="color"
				value={text}
				oninput={(e) => ontext((e.currentTarget as HTMLInputElement).value)}
				class="h-8 w-10 shrink-0 rounded border border-edge bg-transparent"
				aria-label="{label} text colour"
			/>
			text
		</label>
	</div>
	<p class="mt-2 text-[12px] {readable ? 'text-muted' : 'text-danger-ink'}">
		Contrast {ratio.toFixed(1)}:1 —
		{#if readable}
			passes AA for body text.
		{:else}
			below AA (4.5:1); this will be hard to read.
		{/if}
	</p>
</div>
