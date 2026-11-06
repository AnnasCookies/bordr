<script lang="ts">
	import { copyText } from '#lib/copy-text.js';

	/** A function so a highlighted block is read at tap time, not mount time. */
	let { text }: { text: () => string } = $props();

	let status = $state<'idle' | 'done' | 'failed'>('idle');
	let timer: ReturnType<typeof setTimeout> | undefined;
	// One label for the visible text, the accessible name and the live region.
	const label = $derived(status === 'done' ? 'Copied' : status === 'failed' ? 'Failed' : 'Copy');

	async function copy(event: MouseEvent) {
		// Inside a <summary> or a tappable bubble the tap must not do anything else.
		event.stopPropagation();
		status = (await copyText(text())) ? 'done' : 'failed';
		clearTimeout(timer);
		timer = setTimeout(() => (status = 'idle'), 1500);
	}
</script>

<button
	type="button"
	class="copy"
	onclick={copy}
	aria-label={status === 'idle' ? 'Copy code' : label}
>
	{label}
</button>
<span class="sr-only" aria-live="polite">{status === 'idle' ? '' : label}</span>

<style>
	.copy {
		position: absolute;
		top: 3px;
		right: 3px;
		height: 21px;
		padding: 0 0.5em;
		border: 1px solid var(--hairline);
		border-radius: 6px;
		background: var(--code-bg);
		color: var(--faint);
		font: inherit;
		font-size: 11px;
		cursor: pointer;
	}
	/* Small enough to fit a one-line block, with a finger-sized tap area. */
	.copy::after {
		content: '';
		position: absolute;
		inset: -8px;
	}
	.copy:active {
		color: var(--code-ink);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
