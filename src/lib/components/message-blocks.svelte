<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import RichText from './rich-text.svelte';
	import CodeBlock from './code-block.svelte';
	import ToolDetail from './tool-detail.svelte';
	import { langForPath } from '$lib/highlight';
	import { prefs } from '$lib/prefs.svelte';
	import type { Block } from '$lib/server/transcript/types';

	let {
		blocks,
		mono = 11,
		showWork = true,
		plain = false
	}: { blocks: Block[]; mono?: number; showWork?: boolean; plain?: boolean } = $props();

	/**
	 * An Edit is a replacement, so the two sides ARE the diff — no LCS pass
	 * needed to show what changed.
	 * ponytail: whole-hunk diff, not line-matched. If replacing one line of a
	 * 40-line block becomes common, add a real LCS here.
	 */
	function lines(text: string): string[] {
		return text.length === 0 ? [] : text.split('\n');
	}

	/**
	 * Which photos have been opened out. Keyed by index rather than src: the
	 * same screenshot can legitimately appear twice in one turn, and each
	 * copy should open on its own.
	 */
	// SvelteSet, not Set: a plain Set mutated in place is the same object, so
	// nothing would re-render. This one tracks its own reads and writes.
	const expanded = new SvelteSet<number>();

	function toggle(i: number) {
		if (expanded.has(i)) expanded.delete(i);
		else expanded.add(i);
	}

	function hasBody(block: Block): boolean {
		if (block.kind !== 'tool') return false;
		return block.input !== null || block.result !== null || block.diff !== null;
	}
</script>

{#each blocks as block, i (i)}
	{#if block.kind === 'text'}
		{#if plain}
			<!-- What you typed, shown as typed. Rendering a user's own message as
			     markdown turns a stray # or * into formatting they did not ask for. -->
			<span class="typed">{block.text}</span>
		{:else}
			<RichText text={block.text} {mono} />
		{/if}
	{:else if block.kind === 'image'}
		<figure class="shot">
			<!--
				Collapsed to a strip by default. A portrait phone screenshot is
				taller than the viewport, and several of them turn a conversation
				into a scrolling exercise — but shrinking one to a thumbnail
				defeats the point of sending it, so tapping opens it out in place.
			-->
			<button
				type="button"
				class="frame"
				class:open={expanded.has(i) || !prefs.value.compactImages}
				onclick={() => toggle(i)}
				aria-expanded={expanded.has(i)}
			>
				<img src={block.src} alt={block.caption || 'photo'} loading="lazy" />
				{#if !expanded.has(i) && prefs.value.compactImages}<span class="hint">tap to expand</span
					>{/if}
			</button>
			{#if block.caption}<figcaption>{block.caption}</figcaption>{/if}
		</figure>
	{:else if block.kind === 'thinking' && showWork}
		<details class="fold">
			<summary
				><span class="marker" aria-hidden="true"></span><span class="name">thinking</span></summary
			>
			<div class="body"><RichText text={block.text} {mono} /></div>
		</details>
	{:else if block.kind === 'tool' && showWork}
		{#if hasBody(block)}
			<details class="fold tool">
				<summary>
					<span class="marker" aria-hidden="true"></span>
					<span class="name">{block.name}</span>
					<span class="arg">{block.summary}</span>
					{#if block.result?.isError}<span class="bad" title="error">!</span>{/if}
				</summary>
				<div class="body" style="--mono: {mono}px">
					{#if block.diff}
						<!-- Both sides highlighted as the language of the file being
						     edited, so a diff reads like the editor rather than a
						     wall of red and green. -->
						<div class="diff">
							{#if block.diff.before}
								<CodeBlock
									code={lines(block.diff.before)
										.map((l) => `-${l}`)
										.join('\n')}
									lang={langForPath(block.diff.file)}
									{mono}
									tone="del"
								/>
							{/if}
							{#if block.diff.after}
								<CodeBlock
									code={lines(block.diff.after)
										.map((l) => `+${l}`)
										.join('\n')}
									lang={langForPath(block.diff.file)}
									{mono}
									tone="add"
								/>
							{/if}
						</div>
					{:else if block.input}
						<ToolDetail name={block.name} input={block.input} {mono} />
					{/if}
					{#if block.result}
						<pre class="pre out" class:bad={block.result.isError}>{block.result.text}</pre>
						{#if block.result.truncatedLines > 0}
							<p class="more">+{block.result.truncatedLines} more lines</p>
						{/if}
					{/if}
				</div>
			</details>
		{:else}
			<!-- Nothing to expand: a bare row reads better than an accordion
			     that opens onto an empty box. -->
			<div class="fold flat">
				<span class="marker empty" aria-hidden="true"></span>
				<span class="name">{block.name}</span>
				<span class="arg">{block.summary}</span>
			</div>
		{/if}
	{/if}
{/each}

<style>
	.typed {
		white-space: pre-wrap;
	}
	.shot {
		margin: 0 0 0.5em;
	}
	.frame {
		display: block;
		position: relative;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		border-radius: 10px;
		overflow: hidden;
		cursor: pointer;
		/* The collapsed strip. Deep enough to recognise a screenshot by, short
		   enough that three in a row are still scrollable past. */
		max-height: 8.5rem;
	}
	.frame.open {
		max-height: none;
	}
	.frame img {
		display: block;
		width: 100%;
		height: auto;
		border-radius: 10px;
	}
	/* Cropped from the TOP while collapsed: a screenshot's subject is almost
	   always the top of the screen, not the navigation bar at the bottom. */
	.frame:not(.open) img {
		height: 8.5rem;
		object-fit: cover;
		object-position: top;
	}
	.hint {
		position: absolute;
		right: 0.4rem;
		bottom: 0.4rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		font-size: 0.72em;
		pointer-events: none;
	}
	.shot figcaption {
		margin-top: 0.3em;
		font-size: 0.9em;
		opacity: 0.8;
	}

	.fold {
		margin: 0.35em 0;
		border-radius: 8px;
		background: color-mix(in srgb, currentColor 6%, transparent);
	}
	.fold summary,
	.fold.flat {
		display: flex;
		align-items: baseline;
		gap: 0.45em;
		padding: 0.35em 0.55em;
		cursor: pointer;
		/* The default triangle sits badly against a baseline-aligned row. */
		list-style: none;
		min-width: 0;
	}
	.fold summary::-webkit-details-marker {
		display: none;
	}
	.marker {
		flex: none;
		width: 0;
		height: 0;
		border-left: 4px solid currentColor;
		border-top: 3px solid transparent;
		border-bottom: 3px solid transparent;
		opacity: 0.55;
		transition: transform 120ms ease;
	}
	details[open] > summary .marker {
		transform: rotate(90deg);
	}
	.marker.empty {
		border-left-color: transparent;
	}
	.name {
		flex: none;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.92em;
		opacity: 0.75;
	}
	.arg {
		min-width: 0;
		flex: 1;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.92em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bad {
		flex: none;
		font-weight: 700;
		color: #d9534f;
	}

	.body {
		padding: 0 0.55em 0.5em;
	}
	.pre {
		margin: 0 0 0.4em;
		padding: 0.5em 0.6em;
		border-radius: 6px;
		background: color-mix(in srgb, currentColor 8%, transparent);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--mono);
		/* Scroll the block, never the page. */
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
		white-space: pre;
	}
	.pre.out {
		opacity: 0.9;
		/* Bound the row rather than dropping lines: a 40-line result would
		   otherwise push the next message off the screen entirely. */
		max-height: 16em;
		overflow-y: auto;
	}
	.pre.bad {
		background: color-mix(in srgb, #d9534f 12%, transparent);
	}
	.more {
		margin: 0;
		font-size: 0.85em;
		opacity: 0.65;
	}

	.diff {
		margin: 0 0 0.4em;
		max-height: 20em;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
</style>
