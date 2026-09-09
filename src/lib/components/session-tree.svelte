<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { prefs } from '$lib/prefs.svelte';
	import { STATUS_INK, harnessText } from '$lib/theme';
	import type { WorkspaceNode } from '$lib/types';

	let { current = '' }: { current?: string } = $props();

	let workspaces = $state<WorkspaceNode[]>([]);
	let failed = $state(false);
	/** Collapsed workspaces, by id. Everything starts open. */
	const collapsed = new SvelteSet<string>();

	async function load() {
		try {
			const res = await fetch('/api/panes');
			if (!res.ok) throw new Error(String(res.status));
			workspaces = (await res.json()).workspaces ?? [];
			failed = false;
		} catch {
			failed = true;
		}
	}

	$effect(() => {
		void load();
		// The tree changes when panes open and close, which is far less often
		// than a status flips — a slow beat is plenty and costs one call.
		const timer = setInterval(() => void load(), 5000);
		return () => clearInterval(timer);
	});

	/**
	 * `agents` hides shell panes, and with them any tab or workspace left
	 * empty — otherwise choosing "agents" leaves a tree of empty branches.
	 */
	const shown = $derived(
		workspaces
			.map((w) => ({
				...w,
				tabs: w.tabs
					.map((t) => ({
						...t,
						panes: prefs.value.treeScope === 'agents' ? t.panes.filter((p) => p.hasAgent) : t.panes
					}))
					.filter((t) => t.panes.length > 0)
			}))
			.filter((w) => w.tabs.length > 0)
	);

	function toggle(id: string) {
		if (collapsed.has(id)) collapsed.delete(id);
		else collapsed.add(id);
	}

	/**
	 * A tab herdr labelled with its own number reads as a bare "2" in a tree.
	 * Written as a function because an expression starting `{/` is parsed as
	 * a block closing tag, not a regex.
	 */
	function tabLabel(label: string, number: number): string {
		if (!label) return `tab ${number}`;
		return /^\d+$/.test(label) ? `tab ${label}` : label;
	}

	function paneHref(paneId: string) {
		return resolve('/a/[pane]', { pane: paneId });
	}

	const paneCount = $derived(
		shown.reduce((n, w) => n + w.tabs.reduce((m, t) => m + t.panes.length, 0), 0)
	);
</script>

<nav class="flex h-full flex-col border-r border-hairline bg-card" aria-label="Session">
	<div class="flex items-center gap-1 border-b border-hairline px-2 py-1.5">
		<div class="flex flex-1 gap-0.5 rounded-lg bg-chip p-[2px]">
			{#each [{ v: 'all', l: 'All panes' }, { v: 'agents', l: 'Agents' }] as option (option.v)}
				<button
					class="flex-1 rounded-md px-2 py-1 text-[11.5px] {prefs.value.treeScope === option.v
						? 'bg-card text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]'
						: 'text-muted'}"
					aria-pressed={prefs.value.treeScope === option.v}
					onclick={() => prefs.set('treeScope', option.v as 'all' | 'agents')}>{option.l}</button
				>
			{/each}
		</div>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto py-1">
		{#if failed}
			<p class="px-3 py-2 text-[12px] text-muted">herdr is not reachable.</p>
		{:else if shown.length === 0}
			<p class="px-3 py-2 text-[12px] text-muted">Nothing open.</p>
		{/if}

		{#each shown as workspace (workspace.workspaceId)}
			<button
				class="flex w-full items-center gap-1.5 px-2 py-1 text-left"
				onclick={() => toggle(workspace.workspaceId)}
				aria-expanded={!collapsed.has(workspace.workspaceId)}
			>
				<span class="w-2 shrink-0 font-mono text-[9px] text-faint" aria-hidden="true"
					>{collapsed.has(workspace.workspaceId) ? '▸' : '▾'}</span
				>
				<span class="min-w-0 flex-1 truncate font-mono text-[11px] text-muted"
					>{workspace.label || workspace.workspaceId}</span
				>
			</button>

			{#if !collapsed.has(workspace.workspaceId)}
				{#each workspace.tabs as tab (tab.tabId)}
					<!-- A tab with one pane is just that pane; showing a tab row
					     above it would be a row that says nothing. -->
					{#if workspace.tabs.length > 1 || tab.panes.length > 1}
						<p class="truncate py-0.5 pr-2 pl-6 font-mono text-[10.5px] text-faint">
							{tabLabel(tab.label, tab.number)}
						</p>
					{/if}
					{#each tab.panes as pane (pane.paneId)}
						<a
							href={paneHref(pane.paneId)}
							class="flex items-center gap-2 py-1 pr-2 pl-6 {pane.paneId === current
								? 'bg-chip'
								: ''}"
							aria-current={pane.paneId === current ? 'page' : undefined}
						>
							<span
								class="h-1.5 w-1.5 shrink-0 rounded-full {pane.hasAgent
									? (STATUS_INK[pane.status] ?? 'bg-idle-rail')
									: 'bg-idle-rail'}"
								aria-hidden="true"
							></span>
							<span class="min-w-0 flex-1 truncate text-[12.5px]">{pane.title || pane.paneId}</span>
							<span class="shrink-0 font-mono text-[10px] {harnessText(pane.agent)}"
								>{pane.hasAgent ? pane.agent : 'sh'}</span
							>
						</a>
					{/each}
				{/each}
			{/if}
		{/each}
	</div>

	<p class="border-t border-hairline px-2 py-1 font-mono text-[10px] text-faint">
		{paneCount} panes · {shown.length} workspaces
	</p>
</nav>
