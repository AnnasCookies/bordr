<script lang="ts">
	import { previewPlain, previewSegments } from '$lib/preview-markdown';

	/**
	 * A one-line preview with its markdown read rather than printed.
	 *
	 * Bold and code only. The line is already clipped to 80 characters and
	 * drawn at 10-11px, so the job is to stop the markup being noise, not to
	 * reproduce the agent's formatting.
	 *
	 * `title` carries the same text with every mark stripped, so hovering a
	 * truncated row still gives you the sentence.
	 */
	let { text }: { text: string } = $props();

	const segments = $derived(previewSegments(text));
</script>

<span title={previewPlain(text)}
	>{#each segments as segment, i (i)}{#if segment.mark === 'strong'}<span class="font-semibold"
				>{segment.text}</span
			>{:else if segment.mark === 'code'}<span
				class="rounded-[3px] bg-black/[.06] px-[3px] font-mono text-[0.92em] dark:bg-white/[.09]"
				>{segment.text}</span
			>{:else}{segment.text}{/if}{/each}</span
>
