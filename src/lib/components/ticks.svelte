<script lang="ts">
	import Spinner from './spinner.svelte';

	/**
	 * How far one of your messages has got, in the shape a messaging app has
	 * already taught everyone to read.
	 *
	 * The three states are not decoration — each is a thing bordr genuinely
	 * knows, and they were already tracked separately before they had a mark:
	 *
	 *   sending  the POST is still in flight. Nothing is known.
	 *   sent     herdr accepted it, and that is all anyone can say yet.
	 *   read     the AGENT has it: the prompt is on the pane's own screen,
	 *            parked under its composer, or it has reached the transcript.
	 *
	 * The second tick used to wait on the transcript alone, and a harness only
	 * writes that when it STARTS the turn — so a prompt queued behind a long
	 * turn sat on one tick for as long as the turn ran, which reads as stuck
	 * rather than as queued. The screen knows minutes earlier.
	 */
	let { state, size = 13 }: { state: 'sending' | 'sent' | 'read'; size?: number } = $props();

	const LABEL = {
		sending: 'Sending',
		sent: 'Sent — waiting for the agent to pick it up',
		read: 'The agent has it'
	} as const;
</script>

{#if state === 'sending'}
	<Spinner size={size - 2} label={LABEL.sending} />
{:else}
	<!--
		Two overlapping ticks rather than two side by side: the second is offset
		by less than its own width, which is what makes a pair read as one mark
		at 13px instead of as two separate ticks.
	-->
	<span
		class="relative inline-block align-middle {state === 'read' ? 'text-working' : ''}"
		style="width:{state === 'read' ? size + 4 : size}px; height:{size}px"
		role="img"
		aria-label={LABEL[state]}
		title={LABEL[state]}
	>
		{#if state === 'read'}
			<svg
				class="absolute top-0 left-0"
				width={size}
				height={size}
				viewBox="0 0 16 16"
				fill="none"
				aria-hidden="true"
			>
				<path
					d="M1.5 8.5 5.5 12.5 14 4"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		{/if}
		<svg
			class="absolute top-0"
			style="left:{state === 'read' ? 4 : 0}px"
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill="none"
			aria-hidden="true"
		>
			<path
				d="M1.5 8.5 5.5 12.5 14 4"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</span>
{/if}
