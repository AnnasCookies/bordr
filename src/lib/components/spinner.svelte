<script lang="ts">
	/**
	 * The one spinner, for a control that is waiting on the server.
	 *
	 * Drawn in `currentColor` so it works on every button in the app without
	 * being told which: a dark pill, a bordered card, a coloured send button.
	 * `color-mix` for the track rather than a Tailwind opacity modifier,
	 * because the value has to come from the inherited text colour.
	 */
	let { size = 16, label = 'Working' }: { size?: number; label?: string } = $props();
</script>

<span
	class="inline-block shrink-0 rounded-full border-2 motion-safe:animate-spin"
	style="width:{size}px; height:{size}px;
		border-color: color-mix(in srgb, currentColor 25%, transparent);
		border-top-color: currentColor"
	role="status"
	aria-label={label}
></span>
