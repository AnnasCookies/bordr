<script lang="ts">
	import type { Snippet } from 'svelte';
	import NetDot from './net-dot.svelte';
	import { resolve } from '$app/paths';
	import { prefs } from '$lib/prefs.svelte';
	import { showChrome, touchPoints } from '$lib/header-chrome';

	/**
	 * The one bar across the top of the app.
	 *
	 * Ordered the way a site nav is ordered — shadcn-svelte's own is the model:
	 * the menu button first, then the brand, then whatever this page has to
	 * say, then the actions pushed to the far end. The brand IS the way home,
	 * which is why there is no back arrow; a ← next to a menu that opens the
	 * very list it goes back to was two controls for one job.
	 */
	let {
		onmenu,
		menuLabel = 'Menu',
		menuExpanded = false,
		middle,
		actions,
		below
	}: {
		onmenu: () => void;
		menuLabel?: string;
		menuExpanded?: boolean;
		middle?: Snippet;
		actions?: Snippet;
		/**
		 * A second row under `middle`, running the full width left after the
		 * menu and the brand. `middle` itself is squeezed between the brand and
		 * the actions — about 178px on a phone — which is not enough for a path
		 * and a branch. Anything that needs the room goes here.
		 */
		below?: Snippet;
	} = $props();

	/**
	 * The three controls, decided here rather than by each caller.
	 *
	 * Five screens draw this header and every one of them wants the same
	 * answer; asking each to work it out was five chances to disagree.
	 */
	const touch = $derived(touchPoints());
	const showBack = $derived(showChrome(prefs.value.backButton, touch));
	const showMenu = $derived(showChrome(prefs.value.menuButton, touch));
	const showLogo = $derived(showChrome(prefs.value.logoButton, touch));
</script>

<!--
	items-stretch (the default), not items-center: the menu and the brand take
	the full height of the column beside them, so a second row makes them taller
	rather than leaving them stranded against the first. Each centres its own
	contents, so the glyph and the mark still sit on the middle line.

	The top padding reserves the status bar. `viewport-fit=cover` is set, which
	is what makes `env(safe-area-inset-*)` real, and the bottom was already
	using it for the tab bar and the + button — the top never was, so on a
	phone the dog sat hard against the top of the screen under the clock. The
	`max()` floor keeps a real gap where there is no inset to reserve — a
	browser tab rather than an installed app, and every desktop. 10px and not
	6: the dog overhangs the top of his own box by 2px, so 6 left him four
	pixels off the edge of the screen and reading as cropped.
-->
<div
	class="flex gap-2 px-2 pt-[max(0.625rem,env(safe-area-inset-top))] pb-0.5 [@media(max-height:430px)]:pb-0"
>
	<!--
		The menu and the brand are one control group, so they get their own
		tighter gap. The gap on the row outside sets the distance from the title,
		which wants the room; these two do not.
	-->
	<span class="flex shrink-0 items-stretch gap-0.5">
		{#if showBack}
			<!--
				First, where a back control belongs, and narrower than the menu
				beside it: the row is about 178px wide on a phone once the mark and
				the actions have taken theirs, and the title needs what is left.
			-->
			<a
				href={resolve('/')}
				class="flex w-8 shrink-0 grow-0 items-center justify-center self-stretch rounded-lg text-[20px] leading-none text-muted"
				aria-label="Back to agents">&#x2190;</a
			>
		{/if}
		{#if showMenu}
			<button
				class="flex w-10 shrink-0 grow-0 items-center justify-center self-stretch rounded-lg text-[26px] leading-none text-muted"
				aria-label={menuLabel}
				aria-expanded={menuExpanded}
				onclick={onmenu}>☰</button
			>
		{/if}
		<!--
		The mark alone. The name is on the tab, the manifest and the address bar
		already, and next to a pane's own title it was the least useful word on
		the screen — so it only speaks when spoken to.

		Dropped entirely when there is a back arrow, because the two go to the
		same place and the arrow is the one that reads as a control. Keeping
		both spent 56px of a 320px header on saying "home" twice, which is what
		pushed the actions off the end of it.
	-->
		{#if showLogo}
			<a
				href={resolve('/')}
				class="group relative flex shrink-0 items-center self-stretch {showBack
					? 'max-[359px]:hidden'
					: ''}"
				aria-label="bordr — all agents"
			>
				<!--
				The dog out of a hole.

				The hole is a 40px disc at the bottom of a 56×52 box. He is drawn
				at 56px — half again its width — and masked by the UNION of two
				shapes: a full-width band covering everything above the hole's
				centre line, and the hole's own disc below it. So he is cut to the
				rim where he enters it and completely free above it.

				Both mask numbers are in the IMG's own coordinates, so they move
				with BOTH sizes: the disc sits at (imgSize/2, 54 − holeRadius) and
				the band reaches down to that same centre line. Change either size
				without redoing them and the hole detaches from the rim.

				40 and not 28 for the hole: at 28 he covered it almost entirely and
				it stopped reading as a hole at all. Widening costs overhang — a
				taller disc puts its own rim closer to his ears — so this is the
				balance point, rim visible either side of his shoulders with a
				good head still above it.

				A mask and not `overflow-hidden`: a clip box narrow enough to match
				the hole also clipped his ears, and one wide enough to spare them
				had a bottom edge that no longer followed the circle. The union is
				the only shape that is both.

				collie.svg and not patrl-face.png: the PNG is opaque RGB on white,
				so anything overhanging the hole would drag a white square with it.
				The SVG is the same pixel art as bare 1×1 rects on nothing.
			-->
				<span class="relative block h-[52px] w-14 shrink-0 self-center">
					<span
						class="absolute bottom-0 left-1/2 h-10 w-10 -translate-x-1/2 rounded-full bg-chip ring-1 ring-black/10 dark:ring-white/15"
					></span>
					<img
						src="/collie.svg"
						alt=""
						class="absolute bottom-[-2px] left-1/2 h-14 w-14 max-w-none -translate-x-1/2"
						style="image-rendering: pixelated;
						-webkit-mask-image: radial-gradient(circle 20px at 28px 34px, #000 100%, transparent 100%), linear-gradient(#000, #000);
						mask-image: radial-gradient(circle 20px at 28px 34px, #000 100%, transparent 100%), linear-gradient(#000, #000);
						-webkit-mask-size: 100% 100%, 100% 34px;
						mask-size: 100% 100%, 100% 34px;
						-webkit-mask-repeat: no-repeat;
						mask-repeat: no-repeat;
						-webkit-mask-composite: source-over;
						mask-composite: add"
					/>
				</span>
				<span
					class="pointer-events-none absolute top-full left-1/2 z-20 mt-1.5 -translate-x-1/2 rounded-lg bg-ink px-2 py-1 text-[11px] font-medium whitespace-nowrap text-card opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
					aria-hidden="true"
				>
					<!-- The bubble's tail, drawn as a rotated corner of the bubble itself. -->
					<span class="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-ink"></span>
					woof
				</span>
			</a>
		{/if}
	</span>

	<!--
		One column for everything that is not the menu or the brand, so `below`
		starts where `middle` starts without a hardcoded indent to keep in step
		with the widths of the two controls beside it.
	-->
	<span class="flex min-w-0 flex-1 flex-col">
		<!--
			With no second row, this one takes the whole height so its contents
			centre against the brand. The brand's box is 52px and this row's floor
			is 36, so left at the top the bell sat 28px above the middle of the
			menu glyph beside it — two controls on the same bar, visibly on
			different lines. With a `below` row present the old behaviour stands,
			for the reason under `actions`.
		-->
		<span class="flex min-h-9 items-center gap-2 {below ? '' : 'flex-1'}">
			{#if middle}
				<span class="min-w-0 flex-1">{@render middle()}</span>
			{:else}
				<span class="flex-1"></span>
			{/if}

			<!--
				The actions sit INSIDE this column, on its first row, so `below`
				runs the full width underneath them. Pulling them out to centre
				on the header's full height moved them 8px — invisible on a phone
				— and took 115px off the row below, which was enough to start
				clipping branch names. The row below needs the width more than
				these two need the centre line.
			-->
			<!--
				The connection dot belongs to the bar, not to a page: a dead stream
				looks exactly like a quiet fleet on every screen that does not have
				a transcript to watch stop moving. Before the page's own actions,
				so it sits in the same place everywhere.
			-->
			<span class="flex shrink-0 items-center gap-1">
				<NetDot />
				{#if actions}{@render actions()}{/if}
			</span>
		</span>

		{#if below}
			<span class="min-w-0">{@render below()}</span>
		{/if}
	</span>
</div>
