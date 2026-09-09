<script lang="ts">
	import RichText from './rich-text.svelte';
	import type { ResolvedPathname } from '$app/types';
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

	function hasBody(block: Block): boolean {
		if (block.kind !== 'tool') return false;
		return block.detail !== '' || block.result !== null || block.diff !== null;
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
			<!-- Opens the full-size original; a phone screenshot is unreadable
			     at thumbnail height and the cap below makes it one. -->
			<!--
				Opens the full-size original. Cast rather than resolve()d: `src`
				is not a route but a byte endpoint (/api/uploads/… or /raw/…)
				composed server-side by `servableUrl`, and it opens in a new tab
				rather than navigating the app. Same escape hatch the file
				viewer uses for its download links.
			-->
			<a href={block.src as ResolvedPathname} target="_blank" rel="noopener noreferrer">
				<img src={block.src} alt={block.caption || 'photo'} loading="lazy" />
			</a>
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
						<div class="diff">
							{#each lines(block.diff.before) as line, n (`-${n}`)}
								<div class="del">-{line}</div>
							{/each}
							{#each lines(block.diff.after) as line, n (`+${n}`)}
								<div class="add">+{line}</div>
							{/each}
						</div>
					{:else if block.detail}
						<pre class="pre">{block.detail}</pre>
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
	.shot img {
		max-width: 100%;
		/* A portrait phone screenshot is twice the viewport tall, so one photo
		   costs several screens of scrolling to get past. Capped and tappable
		   rather than shrunk to a thumbnail: the point of sending a screenshot
		   is usually that it is readable. */
		max-height: 55vh;
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: 10px;
		display: block;
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
		border-radius: 6px;
		overflow-x: auto;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--mono);
		background: color-mix(in srgb, currentColor 8%, transparent);
		padding: 0.4em 0;
	}
	.diff div {
		padding: 0 0.6em;
		white-space: pre;
	}
	.del {
		background: color-mix(in srgb, #d9534f 16%, transparent);
	}
	.add {
		background: color-mix(in srgb, #3fa45b 16%, transparent);
	}
</style>
