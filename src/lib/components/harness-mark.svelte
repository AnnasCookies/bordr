<script lang="ts">
	import { HARNESS_LOGO } from '$lib/harness-logos';
	import { harnessIcon } from '$lib/theme';

	/**
	 * A harness's own mark, where one exists.
	 *
	 * Sized in `em` and filled with `currentColor`, so it drops into the same
	 * span the glyph used to sit in and keeps that span's size and accent. An
	 * agent with no brand mark — codex and grok have none to use, pi and omp
	 * have none at all — falls back to the Nerd Font glyph rather than to
	 * somebody else's logo.
	 */
	let { agent = '' }: { agent?: string } = $props();

	const path = $derived(HARNESS_LOGO[agent] ?? '');
</script>

{#if path}
	<svg
		viewBox="0 0 24 24"
		width="1em"
		height="1em"
		fill="currentColor"
		aria-hidden="true"
		style="display:inline-block;vertical-align:-0.125em"
	>
		<path d={path} />
	</svg>
{:else}
	<span class="font-mono" aria-hidden="true">{harnessIcon(agent)}</span>
{/if}
