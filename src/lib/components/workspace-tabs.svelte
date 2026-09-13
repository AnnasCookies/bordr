<script lang="ts">
	import { track } from '$lib/pending.svelte';
	import Icon from './icon.svelte';
	import Spinner from './spinner.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { prefs } from '$lib/prefs.svelte';
	import { STATUS_RAIL, harnessText } from '$lib/theme';
	import HarnessMark from './harness-mark.svelte';
	import type { WorkspaceNode } from '$lib/types';

	let {
		current,
		panes = true,
		onsiblings
	}: {
		current: string;
		panes?: boolean;
		/**
		 * The panes a swipe should move between, in tab order.
		 *
		 * Reported upward rather than fetched again by the page: this component
		 * already polls `/api/panes` for the bar it draws, and the sidebar polls
		 * it too. A third caller for the same tree would be three requests every
		 * five seconds to answer one question.
		 */
		onsiblings?: (panes: string[]) => void;
	} = $props();

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

	// One entry per tab, in the order the bar shows them.
	$effect(() => {
		onsiblings?.(tabs.map(tabTarget).filter(Boolean));
	});

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

	/**
	 * A pane's name in the strip. A shell's terminal title is the whole
	 * `user@host: ~/path`, which is far too long for a chip — the directory
	 * is the part that tells them apart.
	 */
	function paneLabel(pane: (typeof tabPanes)[number]): string {
		if (pane.hasAgent) return pane.title || pane.paneId;
		const cwd = pane.cwd.replace(/^\/home\/[^/]+/, '~');
		return cwd.split('/').filter(Boolean).pop() || cwd || 'shell';
	}

	/**
	 * A tab's name. herdr labels a tab with its own number unless you rename
	 * it, and "tab 2" tells you nothing about what is in it — so an unnamed
	 * tab borrows the name of what it holds.
	 */
	function label(tab: (typeof tabs)[number]) {
		const named = tab.label && !/^\d+$/.test(tab.label);
		if (named) return tab.label;
		if (!prefs.value.smartTabLabels) return `tab ${tab.label || tab.number}`;
		const agent = tab.panes.find((p) => p.hasAgent && p.title);
		if (agent) return agent.title;
		const shell = tab.panes.find((p) => p.cwd);
		return shell ? paneLabel(shell) : `tab ${tab.label || tab.number}`;
	}

	/** `w3:p2` → `p2`: enough to tell two shells in the same directory apart. */
	function shortPane(paneId: string): string {
		return paneId.slice(paneId.lastIndexOf(':') + 1);
	}

	/** The panes in the open tab — a tab holds one or more, split. */
	const openTab = $derived(tabs.find((t) => t.tabId === currentTab));
	const tabPanes = $derived(openTab?.panes ?? []);

	/**
	 * herdr's `+`: a new tab in the open workspace, then straight into it.
	 *
	 * `tab.create` opens the tab with a shell already in it and returns that
	 * pane, so there is nothing to wait for or poll.
	 */
	let creating = $state(false);

	async function newTab() {
		const target = workspace;
		if (!target || creating) return;
		creating = true;
		try {
			const res = await track(() =>
				fetch('/api/tabs', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ workspaceId: target.workspaceId })
				})
			);
			if (!res.ok) return;
			const { paneId } = await res.json();
			await load();
			if (paneId) await goto(resolve('/a/[pane]', { pane: paneId }));
		} catch {
			// The bar keeps working; a failed create just leaves you where you were.
		} finally {
			creating = false;
		}
	}

	/**
	 * The worst status in a tab, so the bar can show what needs a human.
	 *
	 * STATUS_RAIL, not STATUS_INK: the ink map is text colours, and a dot is
	 * painted with a background — the dots here and in the sidebar were
	 * carrying `text-working` on an empty span and rendering as nothing.
	 */
	function tone(tab: (typeof tabs)[number]) {
		const statuses = tab.panes.map((p) => p.status);
		if (statuses.includes('blocked')) return STATUS_RAIL.blocked;
		if (statuses.includes('working')) return STATUS_RAIL.working;
		return '';
	}

	function paneDot(pane: (typeof tabPanes)[number]): string {
		if (!pane.hasAgent) return 'bg-edge';
		return STATUS_RAIL[pane.status] ?? 'bg-idle-rail';
	}
</script>

<!--
	The workspace's tabs, where herdr puts them: across the top of the work
	area rather than buried in the sidebar tree.
-->
{#if workspace}
	<!--
		`pt-1.5` because the strip had none: each tab's own `py-1.5` was the only
		thing between its label and the header above, so the row read as stuck to
		the bottom of the header rather than as its own strip. Six plus six is
		the same twelve the agents list leaves under the header.

		Top only — the active tab's underline is the bottom edge and belongs
		against the pane strip it labels.
	-->
	<div class="flex items-stretch gap-1 border-b border-hairline px-2 pt-0.5">
		<div
			class="flex min-w-0 flex-1 gap-1 overflow-x-auto"
			role="tablist"
			aria-label="Tabs in {workspace?.label || 'this workspace'}"
		>
			{#each tabs as tab (tab.tabId)}
				{@const target = tabTarget(tab)}
				{@const open = tab.tabId === currentTab}
				<!--
					Underlined rather than a pill. A row of pills reads as a row of
					buttons; the underline says which one the pane strip below
					belongs to, which is the whole point of having both.
				-->
				<a
					href={resolve('/a/[pane]', { pane: target })}
					role="tab"
					aria-selected={open}
					class="flex shrink-0 items-center gap-1.5 border-b-2 px-1.5 py-1.5 text-[12.5px] {open
						? 'border-working text-ink'
						: 'border-transparent text-muted'}"
				>
					{#if tone(tab)}
						<span class="h-1.5 w-1.5 rounded-full {tone(tab)}" aria-hidden="true"></span>
					{/if}
					<span class="max-w-[10rem] truncate">{label(tab)}</span>
					{#if tab.panes.length > 1}
						<span class="rounded bg-chip px-1 font-mono text-[10px] text-faint"
							>{tab.panes.length}</span
						>
					{/if}
				</a>
			{/each}
		</div>

		<button
			type="button"
			class="flex shrink-0 items-center justify-center self-center rounded-lg p-1.5 text-working transition-colors hover:bg-chip disabled:opacity-40"
			aria-label="New tab in {workspace?.label || 'this workspace'}"
			title="New tab"
			disabled={creating}
			onclick={newTab}
			>{#if creating}<Spinner size={15} label="Making a tab" />{:else}<Icon
					name="plus"
					size={15}
				/>{/if}</button
		>
		<!-- herdr parks the host at the right end of the tab bar; blank means this one. -->
		<span class="shrink-0 self-center font-mono text-[10.5px] text-faint"
			>{workspace?.machine || 'local'}</span
		>
	</div>

	<!--
		The panes inside the open tab. A tab is one or more panes split
		together, so a tab bar alone stops one level short of what herdr
		shows — this is the row that lets you reach a terminal sitting beside
		an agent in the same split.
	-->
	{#if panes && tabPanes.length > 1}
		<div
			class="flex items-center gap-1 overflow-x-auto border-b border-hairline bg-chip/40 px-2 py-1"
			role="tablist"
			aria-label="Panes in this tab"
		>
			<span class="shrink-0 font-mono text-[10px] text-faint">split</span>
			{#each tabPanes as pane (pane.paneId)}
				{@const open = pane.paneId === current}
				<a
					href={resolve('/a/[pane]', { pane: pane.paneId })}
					role="tab"
					aria-selected={open}
					class="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] {open
						? 'border-working/60 bg-card text-ink'
						: 'border-transparent text-muted'}"
				>
					<span class="h-1.5 w-1.5 rounded-full {paneDot(pane)}" aria-hidden="true"></span>
					<span class="font-mono text-[11px] {harnessText(pane.agent)}"
						><HarnessMark agent={pane.agent} /></span
					>
					<span class="max-w-[9rem] truncate">{paneLabel(pane)}</span>
					<!--
						Two shells in the same directory are the same word twice; the
						pane's own number is the only thing that tells them apart.
					-->
					{#if !pane.hasAgent}
						<span class="font-mono text-[10px] text-faint">{shortPane(pane.paneId)}</span>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
{/if}
