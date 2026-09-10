<script lang="ts">
	import { HARNESS_LOGO } from '$lib/harness-logos';
	import { HARNESS_MARK } from '$lib/harness-marks';
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

	const brand = $derived(HARNESS_LOGO[agent] ?? '');
	const drawn = $derived(HARNESS_MARK[agent]);
	const path = $derived(brand || (drawn?.d ?? ''));
</script>

{#if path}
	<svg
		viewBox={(!brand && drawn?.box) || '0 0 24 24'}
		width="1em"
		height="1em"
		fill="currentColor"
		aria-hidden="true"
		style="display:inline-block;vertical-align:-0.125em"
	>
		<path d={path} fill-rule={!brand && drawn?.evenodd ? 'evenodd' : 'nonzero'} />
	</svg>
{:else}
	<!--
		A Nerd Font glyph draws its ink well inside the em box, so at the same
		font-size it sits visibly smaller than a mark that fills its 1em
		viewBox — the shell rows read as a different, lesser row. Scaled up to
		match, with the baseline shift the enlargement introduces taken back out.
	-->
	<span
		class="font-mono"
		aria-hidden="true"
		style="display:inline-block;font-size:1.3em;line-height:1;vertical-align:-0.1em"
		>{harnessIcon(agent)}</span
	>
{/if}
