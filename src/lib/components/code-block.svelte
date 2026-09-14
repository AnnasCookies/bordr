<script lang="ts">
	import { prefs } from '$lib/prefs.svelte';
	import { highlight } from '$lib/highlight';

	let {
		code,
		lang = null,
		mono = 11,
		tone = 'plain'
	}: {
		code: string;
		lang?: string | null;
		mono?: number;
		/** Diff sides carry their own background; plain blocks get the neutral one. */
		tone?: 'plain' | 'add' | 'del';
	} = $props();

	/**
	 * Highlighted markup, or null until it arrives (and forever, for a
	 * language with no grammar). Rendering the plain text first and upgrading
	 * in place means a slow grammar fetch never blanks the block.
	 */
	let lit = $state<string | null>(null);

	$effect(() => {
		const source = code;
		const language = lang;
		const dark = prefs.resolvedTheme === 'dark';
		let cancelled = false;
		lit = null;
		if (!prefs.value.syntaxHighlight) return;
		void highlight(source, language, dark).then((html) => {
			if (!cancelled) lit = html;
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<!-- eslint-disable svelte/no-at-html-tags -->
<pre class="code {tone}" style="--mono: {mono}px">{#if lit}{@html lit}{:else}{code}{/if}</pre>

<style>
	.code {
		margin: 0;
		padding: 0.5em 0.6em;
		border-radius: 6px;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--mono);
		/* Its own ink as well as its own surface: inside a filled bubble the
		   inherited colour is whatever reads on THAT fill, which on a harness
		   fill is black — unreadable on the neutral code surface in dark. */
		color: var(--code-ink);
		/* Scroll the block, never the page. */
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		white-space: pre;
		tab-size: 2;
	}
	.plain {
		background: var(--code-bg);
	}
	/* The diff tones mix INTO the code surface rather than washing over
	   whatever is behind, so a diff inside a coloured bubble still reads. */
	.add {
		background: color-mix(in srgb, #3fa45b 18%, var(--code-bg));
	}
	.del {
		background: color-mix(in srgb, #d9534f 18%, var(--code-bg));
	}
</style>
