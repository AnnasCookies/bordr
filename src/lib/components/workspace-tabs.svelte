<script lang="ts">
	import { resolve } from '$app/paths';
	import { STATUS_INK } from '$lib/theme';
	import type { WorkspaceNode } from '$lib/types';

	let { current }: { current: string } = $props();

	let workspaces = $state<WorkspaceNode[]>([]);

	async function load() {
		try {
			const res = await fetch('/api/panes');
			if (res.ok) workspaces = (await res.json()).workspaces ?? [];
		} catch {
			// Keep the last tabs rather than blanking the bar.
		}
	}

	$effect(() => {
		void load();
		const timer = setInterval(() => void load(), 5000);
		return () => clearInterval(timer);
	});

	/** The workspace the open pane belongs to. */
	const workspace = $derived(
		workspaces.find((w) => w.tabs.some((t) => t.panes.some((p) => p.paneId === current)))
	);

	const tabs = $derived(workspace?.tabs ?? []);
	const currentTab = $derived(
		tabs.find((t) => t.panes.some((p) => p.paneId === current))?.tabId ?? ''
	);

	/**
	 * Where a tab goes: the pane you were last on if it is in that tab,
	 * otherwise its first agent, otherwise its first pane. A tab is a place,
	 * and landing on a shell when the tab has an agent in it is the wrong
	 * place.
	 */
	function tabTarget(tab: (typeof tabs)[number]) {
		const agent = tab.panes.find((p) => p.hasAgent);
		return (agent ?? tab.panes[0])?.paneId ?? '';
	}

	function label(tab: (typeof tabs)[number]) {
		if (!tab.label) return `tab ${tab.number}`;
		return /^\d+$/.test(tab.label) ? `tab ${tab.label}` : tab.label;
	}

	/** The worst status in a tab, so the bar can show what needs a human. */
	function tone(tab: (typeof tabs)[number]) {
		const statuses = tab.panes.map((p) => p.status);
		if (statuses.includes('blocked')) return STATUS_INK.blocked;
		if (statuses.includes('working')) return STATUS_INK.working;
		return '';
	}
</script>

<!--
	The workspace's tabs, where herdr puts them: across the top of the work
	area rather than buried in the sidebar tree.
-->
{#if tabs.length > 1}
	<div
		class="flex gap-1 overflow-x-auto border-b border-hairline px-2 py-1"
		role="tablist"
		aria-label="Tabs in {workspace?.label || 'this workspace'}"
	>
		{#each tabs as tab (tab.tabId)}
			{@const target = tabTarget(tab)}
			<a
				href={resolve('/a/[pane]', { pane: target })}
				role="tab"
				aria-selected={tab.tabId === currentTab}
				class="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] {tab.tabId ===
				currentTab
					? 'bg-chip text-ink'
					: 'text-muted'}"
			>
				{#if tone(tab)}
					<span class="h-1.5 w-1.5 rounded-full {tone(tab)}" aria-hidden="true"></span>
				{/if}
				<span class="max-w-[10rem] truncate">{label(tab)}</span>
				<span class="font-mono text-[10px] text-faint">{tab.panes.length}</span>
			</a>
		{/each}
	</div>
{/if}
