<script lang="ts" module>
	/**
	 * Inline 24-viewBox stroke icons, traced from the design file.
	 *
	 * Inline rather than a Lucide dependency: the handoff asks for exactly
	 * eleven glyphs, and `currentColor` + stroke 2 is the whole contract.
	 */
	export type IconName =
		| 'list'
		| 'home'
		| 'search'
		| 'folder'
		| 'settings'
		| 'plus'
		| 'bell'
		| 'keyboard'
		| 'camera'
		| 'mic'
		| 'arrow-up'
		| 'arrow-up-right'
		| 'download'
		| 'share'
		| 'eye'
		| 'stop';
</script>

<script lang="ts">
	let {
		name,
		size = 24,
		class: klass = ''
	}: { name: IconName; size?: number; class?: string } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={klass}
	aria-hidden="true"
>
	{#if name === 'list'}
		<path d="M4 6h16M4 12h16M4 18h10" />
	{:else if name === 'home'}
		<path d="M3 10.5 12 3l9 7.5" />
		<path d="M5.5 9.5V20h13V9.5" />
	{:else if name === 'search'}
		<circle cx="11" cy="11" r="7" />
		<path d="M20 20l-3.5-3.5" />
	{:else if name === 'folder'}
		<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
	{:else if name === 'settings'}
		<!--
			A cog, not a sun. The glyph before this was a circle with eight
			free-standing spokes, and with no outer ring joining their tips that
			is what it read as.

			Generated on a circle rather than typed out by hand: the hand-written
			version put the teeth's centre 1.55 units above the hole, which is
			most of a pixel at this size and exactly the wobble you notice
			without being able to name.

			Four points per tooth, not two. Alternating between an outer and an
			inner radius gives SPIKES, and six of those read as a star — it is
			the flat top and the flat valley that make a tooth a tooth. So each
			of the six is 20° of flat at r=10, a sloped flank, then 22° of flat
			at r=7.2. Six and not eight: at 14px the gaps between eight close up
			into a solid band and the shape goes back to being a disc.
		-->
		<path
			d="M10.26 2.15 L13.74 2.15 L14.46 5.23 L16.63 6.48 L19.66 5.57 L21.40 8.58 L19.09 10.75 L19.09 13.25 L21.40 15.42 L19.66 18.43 L16.63 17.52 L14.46 18.77 L13.74 21.85 L10.26 21.85 L9.54 18.77 L7.37 17.52 L4.34 18.43 L2.60 15.42 L4.91 13.25 L4.91 10.75 L2.60 8.58 L4.34 5.57 L7.37 6.48 L9.54 5.23 Z"
		/>
		<circle cx="12" cy="12" r="3.2" />
	{:else if name === 'plus'}
		<path d="M12 5v14M5 12h14" />
	{:else if name === 'bell'}
		<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4" />
	{:else if name === 'keyboard'}
		<rect x="3" y="6" width="18" height="12" rx="2" />
		<path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
	{:else if name === 'camera'}
		<path d="M4 8h3l2-3h6l2 3h3v11H4z" />
		<circle cx="12" cy="13" r="3.5" />
	{:else if name === 'mic'}
		<rect x="9" y="3" width="6" height="12" rx="3" />
		<path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
	{:else if name === 'arrow-up'}
		<path d="M12 19V5M5 12l7-7 7 7" />
	{:else if name === 'arrow-up-right'}
		<path d="M7 17L17 7M9 7h8v8" />
	{:else if name === 'download'}
		<path d="M12 4v11M7 10l5 5 5-5M4 19h16" />
	{:else if name === 'share'}
		<path d="M12 15V4M7 9l5-5 5 5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
	{:else if name === 'eye'}
		<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z" />
		<circle cx="12" cy="12" r="3" />
	{:else if name === 'stop'}
		<rect x="4" y="4" width="16" height="16" rx="3" />
		<path d="M8 12h8" />
	{/if}
</svg>
