<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import Icon, { type IconName } from './icon.svelte';

	const TABS: Array<{
		href: ResolvedPathname;
		label: string;
		icon: IconName;
		match: (p: string) => boolean;
	}> = [
		{
			href: resolve('/'),
			label: 'Agents',
			icon: 'list',
			match: (p) => p === '/' || p.startsWith('/a/')
		},
		{
			href: resolve('/search'),
			label: 'Search',
			icon: 'search',
			match: (p) => p.startsWith('/search')
		},
		{
			// The roots list, not a guessed root: 'dev' only exists by default
			// and 404s on any machine that configured BORDR_FILE_ROOTS.
			href: resolve('/f/[...path]', { path: '' }),
			label: 'Files',
			icon: 'folder',
			match: (p) => p.startsWith('/f')
		},
		{
			href: resolve('/settings'),
			label: 'Settings',
			icon: 'settings',
			match: (p) => p.startsWith('/settings')
		}
	];
</script>

<nav
	class="sticky bottom-0 z-20 grid grid-cols-4 border-t border-hairline bg-card pt-2.5"
	style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom))"
>
	{#each TABS as tab (tab.href)}
		{@const active = tab.match(page.url.pathname)}
		<a
			href={tab.href}
			aria-current={active ? 'page' : undefined}
			class="flex min-h-11 flex-col items-center gap-0.5 {active
				? 'font-medium text-ink'
				: 'text-faint'}"
		>
			<Icon name={tab.icon} size={22} />
			<span class="text-[11px]">{tab.label}</span>
		</a>
	{/each}
</nav>
