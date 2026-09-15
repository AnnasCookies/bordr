<script lang="ts">
	import type { Snippet } from 'svelte';
	import { contrastRatio, luminance, parseHex } from '$lib/contrast';
	import { fillFar } from '$lib/bubble-colour';

	/**
	 * One chat bubble — the shape, the rule, the run corners and the tail.
	 *
	 * A component rather than a copied block because there are two callers
	 * with different content (the transcript renders MessageBlocks, the
	 * settings swatch renders a line of sample text) and the geometry is
	 * fiddly enough that it had already drifted: the settings preview was
	 * still drawing a 3px left stripe the transcript had stopped using.
	 */

	/** Where this bubble sits in a run of turns from the same speaker. */
	export type RunPos = 'only' | 'first' | 'mid' | 'last';

	let {
		mine = false,
		run = 'only',
		border,
		fill,
		fillGradient = false,
		fillEnd = null,
		tail = true,
		width = 2,
		ink,
		small = false,
		extra = '',
		children,
		meta
	}: {
		mine?: boolean;
		run?: RunPos;
		/** The rule's colour, or null for no border at all. */
		border: string | null;
		/** What sits behind the text, or null to let the page show through. */
		fill: string | null;
		/** Fade the fill away from the tail corner instead of laying it flat. */
		fillGradient?: boolean;
		/** What the fade ends on. Null derives it from the fill — see fillFar. */
		fillEnd?: string | null;
		/** Draw the pointer. Off leaves the squared corner and nothing else. */
		tail?: boolean;
		/** Rule thickness in px. The tail's geometry follows it. */
		width?: number;
		ink: string;
		/** Tighter padding and type, for the settings swatch. */
		small?: boolean;
		extra?: string;
		children: Snippet;
		/**
		 * The time and the ticks, tucked into the bottom-right corner the way
		 * every messaging app puts them.
		 */
		meta?: Snippet;
	} = $props();

	/** The rule at its strong end — where the tail meets it, so the two match. */
	/**
	 * The rule's colour, shifted when it would vanish into the fill behind it.
	 *
	 * The harness `fill` mode forces this: it paints the bubble and the rule
	 * the same colour — a contrast ratio of exactly 1.00 — so the border is
	 * simply not there. Rather than special-case that one mode, any fill the
	 * rule cannot be told apart from pushes it away: towards black on a light
	 * fill, white on a dark one.
	 *
	 * 1.6:1 is a deliberate floor, not an accessibility one. This is a 2px
	 * line against its own background, not text, and a higher bar turned a
	 * tinted bubble's rule into a hard outline it did not want.
	 *
	 * CSS variables are left alone — they cannot be measured, and each one
	 * used here is a neutral already distinct from its fill.
	 */
	const ruled = $derived.by(() => {
		if (!border || !fill) return border;
		if (!parseHex(border) || !parseHex(fill)) return border;
		if (contrastRatio(border, fill) >= 1.6) return border;
		const anchor = luminance(fill) > 0.4 ? '#000000' : '#ffffff';
		return `color-mix(in srgb, ${border} 55%, ${anchor})`;
	});

	/** The rule at its strong end — where the tail meets it, so the two match. */
	const strong = $derived(ruled ? `color-mix(in srgb, ${ruled} 90%, transparent)` : 'transparent');

	/**
	 * The tail has to be painted with something opaque even when the bubble
	 * has no fill: its job in the mouth is to mask the border it interrupts,
	 * and a transparent mask masks nothing.
	 */
	const tailFill = $derived(fill ?? 'var(--page)');

	/**
	 * `border-color` cannot take a gradient, so the rule is PAINTED rather than
	 * stroked: the fill is clipped to `padding-box`, the gradient to
	 * `border-box`, and the border itself stays transparent — it exists only
	 * to reserve the strip the gradient shows through.
	 *
	 * The direction anchors on the speaker's own tail corner, so both sides
	 * lean towards whoever is talking.
	 */
	/** The direction everything leans: out of the speaker's own tail corner. */
	const dir = $derived(mine ? 'to top left' : 'to top right');

	/**
	 * The fill, flat or fading.
	 *
	 * The gradient runs the same way as the rule and dies well before the far
	 * corner, so it reads as the bubble catching a little light from where the
	 * voice is rather than as a two-tone panel. It has to end on the page
	 * colour rather than on `transparent`: fading a colour to transparent
	 * travels through its own alpha ramp, which browsers render greyer in the
	 * middle than either end.
	 */
	const fillPaint = $derived.by(() => {
		if (!fill) return null;
		if (!fillGradient) return fill;
		// A resolved hex, not a color-mix: the text colour is chosen against
		// this exact value, and the two must not be able to disagree.
		return `linear-gradient(${dir}, ${fill}, ${fillEnd ?? fillFar(fill)} 75%)`;
	});

	const paint = $derived.by(() => {
		const bg = fillPaint ? `background:${fillPaint}` : 'background:transparent';
		// No border means no border BOX either — `border-width: 0` above, not a
		// transparent 2px one.
		//
		// A transparent border is not invisible when the fill is a gradient.
		// `background-origin` defaults to the padding box while
		// `background-clip` defaults to the border box, so the gradient is
		// measured across the padding box and then painted out over the border
		// strip with its end colour CLAMPED — a hard step, not a fade. Measured
		// on a bordered-off blue bubble: #2D4BC6 for exactly two pixels around
		// an interior of #2640A8, which reads as the border you just switched
		// off. Zero width, no strip, no step.
		if (!border) return `${bg}; border-color:transparent`;
		// A gradient rule needs something behind it clipped to the padding box,
		// and `transparent` there would let the gradient show through the whole
		// bubble rather than only its border strip.
		const under = fillPaint ?? 'var(--page)';
		const layer = fillPaint && fillGradient ? under : `linear-gradient(${under},${under})`;
		// Over a fill the faded end of the rule fades INTO that fill rather than
		// into the page, so 6% left the far half of a filled bubble looking
		// unbordered. It keeps a third of its strength instead.
		const far = fill
			? `color-mix(in srgb, ${ruled} 38%, transparent) 75%`
			: `color-mix(in srgb, ${ruled} 6%, transparent) 70%`;
		return (
			`border-color:transparent` +
			`; background:${layer} padding-box` +
			`, linear-gradient(${dir}, ${strong}, ${far}) border-box`
		);
	});

	/** No border means no outline to continue, so no tail either. */
	const tailed = $derived(tail && !!border && (run === 'only' || run === 'last'));

	/**
	 * The tail's geometry is derived from the border width, not hardcoded.
	 *
	 * An absolutely positioned child resolves against its parent's PADDING
	 * box, so the offsets have to add the border back to land 12px outside the
	 * bubble's actual edge; and a stroke is centred on its path, so the ends
	 * belong on the border's centre line, half a width in. Both were written
	 * for a 2px rule, and every earlier version of this tail that looked a
	 * pixel out was one of these two numbers being wrong.
	 */
	const tailBox = $derived(
		`bottom:${-width}px; ${mine ? 'right' : 'left'}:${-(12 + width)}px; width:14px; height:18px`
	);
	const tx = $derived(12 + width / 2);
	const ty = $derived(18 - width / 2);

	/**
	 * Corners facing the next bubble in a run tighten so the run reads as one
	 * block; a join runs the full width, so BOTH corners along it tighten.
	 * The tail corner squares off completely — the pointer has to meet a right
	 * angle or the outline curves away from the shape continuing it.
	 */
	const corners = $derived.by(() => {
		const tailCorner = mine
			? tailed
				? 'rounded-br-none'
				: 'rounded-br-sm'
			: tailed
				? 'rounded-bl-none'
				: 'rounded-bl-sm';
		return [
			'rounded-2xl',
			run === 'mid' || run === 'last' ? 'rounded-t-sm' : '',
			run === 'mid' || run === 'first' ? 'rounded-b-sm' : '',
			tailCorner
		]
			.filter(Boolean)
			.join(' ');
	});
</script>

<span
	class="relative {small
		? 'px-2.5 py-1.5 text-[12.5px]'
		: 'px-3 py-2'} [overflow-wrap:anywhere] {corners} {extra}"
	style="border:{border ? width : 0}px solid transparent; color:{ink}; {paint}"
>
	{@render children()}

	{#if meta}
		<!--
			A tight line of its own, not a float.

			The float was the obvious way to tuck this onto the END of the last
			line, and it does not work: a float cannot move UP past the line
			boxes before it, so placed after the text it dropped to the next
			line anyway — and the clearfix needed to stop it hanging out of the
			bubble then added a second empty line under that. Two lines of blank
			space to right-align eleven characters.

			`leading-none` with the negative bottom margin pulls it back against
			the text, so it costs the height of the mark and nothing else.

			`select-none` because the time is furniture — copying a message
			should give you the message, not "14:07 ✓✓" welded to the end.
		-->
		<span class="mt-0.5 -mb-1 flex justify-end leading-none select-none">
			{@render meta()}
		</span>
	{/if}

	{#if tailed}
		<!--
			The tail, as an SVG rather than a rotated bordered square. The square
			was the obvious CSS trick and never looked right: its strokes are
			diagonals, so they anti-alias thinner than the bubble's crisp
			horizontal and vertical borders, and CSS will not mitre one to the
			other. A path has a real join and one stroke weight throughout.

			The offsets account for the border: an absolutely positioned child
			resolves against its parent's PADDING box, so `-14px` against a 2px
			border puts the box 12px outside the bubble's actual edge, and the
			path's ends (x = 13, y = 17) land on the borders' centre lines.
			Getting this wrong by exactly the border width is what made every
			earlier version of this tail look a pixel out.

			The overlap is part of the PATH, not two elements meeting: the first
			segment runs down the border's own centre line before the diagonal
			turns off it, so the corner is a mitre the renderer draws. The last
			runs two units past the corner — enough to cover the join, short
			enough that the step where this constant ink meets the fading rule
			sits where the gradient is strongest and the difference is nothing.
		-->
		<svg
			class="pointer-events-none absolute overflow-visible {mine ? '-scale-x-100' : ''}"
			style={tailBox}
			viewBox="0 0 14 18"
			aria-hidden="true"
		>
			<path d="M14 8 L1 18 L14 18 Z" fill={tailFill} />
			<path
				d="M{tx} 3 L{tx} 9 L2 {ty} L16 {ty}"
				fill="none"
				stroke={strong}
				stroke-width={width}
				stroke-linejoin="round"
			/>
		</svg>
	{/if}
</span>
