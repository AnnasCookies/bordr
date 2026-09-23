<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { ROUTED, SECTIONS } from '$lib/settings-sections';

	/**
	 * The settings sections, as a desktop nav.
	 *
	 * Shared by `/settings` and `/settings/connection` so the two cannot
	 * disagree about what exists, and so moving between them does not reflow
	 * the whole app — connection used to be a 640px column where the page you
	 * came from was full width.
	 *
	 * Entries are links, not buttons: the section lives in the URL, so a
	 * section is a thing you can come back to, share, or reach with the
	 * browser's own back button.
	 */
	let { active }: { active: string } = $props();

	/**
	 * Connection and system are routes of their own — they have live state and
	 * a back button of their own — so they navigate rather than switching a pane.
	 */
	const href = (key: string): ResolvedPathname =>
		ROUTED.includes(key)
			? ((resolve('/settings') + `/${key}`) as ResolvedPathname)
			: ((resolve('/settings') + `?s=${encodeURIComponent(key)}`) as ResolvedPathname);
</script>

<nav
	class="hidden w-[212px] shrink-0 overflow-y-auto border-r border-hairline px-2 py-1 lg:block"
	aria-label="Settings sections"
>
	{#each SECTIONS as key (key)}
		<a
			href={href(key)}
			aria-current={active === key ? 'page' : undefined}
			class="mb-0.5 flex items-center rounded-lg px-3 py-2 text-[13.5px] {active === key
				? 'bg-chip font-medium text-ink'
				: 'text-muted'}"
		>
			{key}
		</a>
	{/each}
</nav>
