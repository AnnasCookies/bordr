<script lang="ts">
	let { value, mono = 11 }: { value: unknown; mono?: number } = $props();

	function object(value: unknown): Record<string, unknown> | null {
		return typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: null;
	}

	function children(value: unknown): Array<[string, unknown]> {
		if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
		return Object.entries(object(value) ?? {});
	}

	function shape(value: unknown, count: number): string {
		return Array.isArray(value) ? `Array(${count})` : `{${count}}`;
	}

	function primitive(value: unknown): string {
		if (typeof value === 'string') return JSON.stringify(value);
		if (value === null) return 'null';
		return String(value);
	}

	function tone(value: unknown): string {
		if (value === null) return 'null';
		return typeof value;
	}

	const root = $derived(children(value));
</script>

{#snippet node(item: unknown, key: string | null)}
	{@const entries = children(item)}
	{#if entries.length > 0}
		<details>
			<summary>
				{#if key !== null}<span class="key">{key}</span><span class="punct">: </span>{/if}
				<span class="shape">{shape(item, entries.length)}</span>
			</summary>
			<div class="children">
				{#each entries as [childKey, child] (childKey)}
					{@render node(child, childKey)}
				{/each}
			</div>
		</details>
	{:else if Array.isArray(item) || object(item)}
		<div class="leaf">
			{#if key !== null}<span class="key">{key}</span><span class="punct">: </span>{/if}
			<span class="shape">{Array.isArray(item) ? '[]' : '{}'}</span>
		</div>
	{:else}
		<div class="leaf">
			{#if key !== null}<span class="key">{key}</span><span class="punct">: </span>{/if}
			<span class={tone(item)}>{primitive(item)}</span>
		</div>
	{/if}
{/snippet}

<div class="tree" style="--mono: {mono}px">
	{#if root.length > 0}
		{#each root as [key, child] (key)}
			{@render node(child, key)}
		{/each}
	{:else}
		{@render node(value, null)}
	{/if}
</div>

<style>
	.tree {
		padding: 0.45em 0.55em;
		border-radius: 6px;
		background: var(--code-bg);
		color: var(--code-ink);
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--mono);
		overflow-x: auto;
	}
	details {
		min-width: max-content;
	}
	summary {
		cursor: pointer;
		list-style-position: outside;
		white-space: nowrap;
	}
	.children {
		margin-left: 0.65em;
		padding-left: 0.7em;
		border-left: 1px solid color-mix(in srgb, currentColor 16%, transparent);
	}
	.leaf {
		min-height: 1.55em;
		line-height: 1.55em;
		white-space: nowrap;
	}
	.key {
		color: #9cdcfe;
	}
	.string {
		color: #ce9178;
	}
	.number {
		color: #b5cea8;
	}
	.boolean {
		color: #569cd6;
	}
	.null,
	.shape,
	.punct {
		opacity: 0.68;
	}
	:global(html:not(.dark)) .key {
		color: #0451a5;
	}
	:global(html:not(.dark)) .string {
		color: #a31515;
	}
	:global(html:not(.dark)) .number {
		color: #098658;
	}
	:global(html:not(.dark)) .boolean {
		color: #0000ff;
	}
</style>
