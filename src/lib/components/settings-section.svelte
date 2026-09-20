<!--
	One group of settings.

	On a desktop the nav down the side already shows one section at a time, so
	this is a plain heading and its rows. On a phone there is no nav and every
	section renders at once — eight of them, hundreds of rows, and finding the
	one you want means scrolling past all of it. So on a phone each is a
	disclosure you open.

	`<details>` rather than a button and a flag: it is the platform's own
	disclosure, so it comes with the right role, the right keyboard behaviour
	and find-in-page that can open it. The only thing it needs is to be held
	open where the nav has already done the narrowing.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { screen } from '$lib/wide.svelte';

	let { heading, children }: { heading: string; children: Snippet } = $props();

	// Starts closed on a phone. Not persisted: which group you had open is
	// worth less than landing on the same short list every time.
	let open = $state(false);
	const shown = $derived(screen.wide || open);
</script>

<section>
	<!-- Named, so a test can open the group holding the row it is about. -->
	<details
		data-section={heading}
		open={shown}
		ontoggle={(e) => (open = (e.currentTarget as HTMLDetailsElement).open)}
	>
		<summary
			class="mb-1.5 flex min-h-11 list-none items-center gap-1.5 px-1 py-2 font-mono text-[10.5px] text-muted lg:pointer-events-none lg:min-h-0 lg:py-0 [&::-webkit-details-marker]:hidden"
		>
			<!--
				Still a heading. A summary carries no heading semantics of its
				own, so making the disclosure the group's title would have quietly
				taken the settings page's eight landmarks away from anyone
				navigating it by heading.
			-->
			<h2 class="flex-1 font-mono text-[10.5px] font-normal">{heading}</h2>
			<!-- The same caret the transcript uses for its own collapsed rows. -->
			<span class="shrink-0 text-faint lg:hidden" aria-hidden="true">{open ? '▾' : '▸'}</span>
		</summary>
		{@render children()}
	</details>
</section>
