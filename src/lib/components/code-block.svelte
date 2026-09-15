<script lang="ts">
	import { prefs } from '$lib/prefs.svelte';
	import { highlight } from '$lib/highlight';

	let {
		code,
		lang = null,
		mono = 11,
		tone = 'plain',
		lineNumbers
	}: {
		code: string;
		lang?: string | null;
		mono?: number;
		/** Diff sides carry their own background; plain blocks get the neutral one. */
		tone?: 'plain' | 'add' | 'del';
		/** Exact lines when known; `true` numbers this focused block from one. */
		lineNumbers?: number[] | true;
	} = $props();

	const gutter = $derived(
		lineNumbers === true ? code.split('\n').map((_, index) => index + 1) : lineNumbers
	);

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
{#if gutter}
	<div class="numbered {tone}" style="--mono: {mono}px">
		<pre class="gutter" aria-hidden="true">{gutter.join('\n')}</pre>
		<pre class="code lined">{#if lit}{@html lit}{:else}{code}{/if}</pre>
	</div>
{:else}
	<pre class="code {tone}" style="--mono: {mono}px">{#if lit}{@html lit}{:else}{code}{/if}</pre>
{/if}

<style>
	.code,
	.gutter {
		margin: 0;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--mono);
		line-height: 1.45;
		white-space: pre;
	}
	.code {
		padding: 0.5em 0.6em;
		border-radius: 6px;
		/* Its own ink as well as its own surface: inside a filled bubble the
		   inherited colour is whatever reads on THAT fill, which on a harness
		   fill is black — unreadable on the neutral code surface in dark. */
		color: var(--code-ink);
		/* Scroll the block, never the page. */
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		tab-size: 2;
	}
	.numbered {
		flex-shrink: 0;
		display: flex;
		min-width: 0;
		border-radius: 6px;
		overflow: hidden;
	}
	.numbered .code {
		min-width: 0;
		flex: 1;
		border-radius: 0;
		background: transparent;
	}
	.gutter {
		flex: none;
		padding: 0.5em 0.65em;
		border-right: 1px solid var(--hairline);
		color: var(--faint);
		text-align: right;
		font-variant-numeric: tabular-nums;
		user-select: none;
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
