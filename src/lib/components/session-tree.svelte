<script lang="ts">
	import { resolve } from '$app/paths';
	import { prefs, type AgentOrder } from '$lib/prefs.svelte';
	import { STATUS_INK, harnessIcon, harnessText } from '$lib/theme';
	import type { MachineStatus, PaneNode, WorkspaceNode } from '$lib/types';

	let { current = '', onnew = () => {} }: { current?: string; onnew?: () => void } = $props();

	let workspaces = $state<WorkspaceNode[]>([]);
	let machines = $state<MachineStatus[]>([]);

	async function load() {
		try {
			const res = await fetch('/api/panes');
			if (!res.ok) return;
			const body = await res.json();
			workspaces = body.workspaces ?? [];
			machines = body.machines ?? [];
		} catch {
			// A failed poll keeps the last tree rather than blanking it.
		}
	}

	$effect(() => {
		void load();
		// The tree changes when panes open and close, far less often than a
		// status flips — a slow beat is plenty and costs one call.
		const timer = setInterval(() => void load(), 5000);
		return () => clearInterval(timer);
	});

	/** Every pane, flattened, with the workspace and tab it came from. */
	interface Row extends PaneNode {
		workspaceLabel: string;
		machine: string;
	}

	const allPanes = $derived<Row[]>(
		workspaces.flatMap((w) =>
			w.tabs.flatMap((t) =>
				t.panes.map((p) => ({
					...p,
					workspaceLabel: w.label || w.workspaceId,
					machine: w.machine
				}))
			)
		)
	);

	/** The workspace the open pane belongs to, so the list can mark it. */
	const currentWorkspace = $derived(allPanes.find((p) => p.paneId === current)?.workspaceId ?? '');

	/** Focus follows the open pane until you pick a workspace yourself. */
	const focus = $derived(prefs.value.workspaceFocus || currentWorkspace);

	const RANK: Record<string, number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 };

	/**
	 * The agent section.
	 *
	 * Scoped to the focused workspace, because that is what makes the two
	 * sections a pair rather than two lists of the same thing — picking a
	 * workspace above changes what is below it, as it does in herdr.
	 */
	const agentRows = $derived.by(() => {
		const rows = allPanes.filter(
			(p) => (prefs.value.treeScope === 'all' || p.hasAgent) && (!focus || p.workspaceId === focus)
		);
		return [...rows].sort((a, b) => {
			// Terminals below agents either way: a shell is a place you go, an
			// agent is something that might need you.
			if (a.hasAgent !== b.hasAgent) return a.hasAgent ? -1 : 1;
			if (prefs.value.agentOrder === 'workspace') {
				return a.workspaceLabel.localeCompare(b.workspaceLabel) || a.title.localeCompare(b.title);
			}
			return (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.title.localeCompare(b.title);
		});
	});

	/** Workspaces grouped by machine, this host first and unlabelled. */
	const grouped = $derived.by((): { machine: string; workspaces: WorkspaceNode[] }[] => {
		const groups: { machine: string; workspaces: WorkspaceNode[] }[] = [];
		for (const workspace of workspaces) {
			const machine = workspace.machine ?? '';
			const found = groups.find((g) => g.machine === machine);
			if (found) found.workspaces.push(workspace);
			else groups.push({ machine, workspaces: [workspace] });
		}
		return groups.sort((a, b) =>
			a.machine === '' ? -1 : b.machine === '' ? 1 : a.machine.localeCompare(b.machine)
		);
	});

	/** Machines with no panes in the tree yet, and what they are doing. */
	const pending = $derived(
		machines.filter((m) => !workspaces.some((w) => w.machine === m.machine.label))
	);

	function counts(workspace: WorkspaceNode) {
		const panes = workspace.tabs.flatMap((t) => t.panes);
		return {
			agents: panes.filter((p) => p.hasAgent).length,
			blocked: panes.filter((p) => p.status === 'blocked').length
		};
	}

	function paneHref(paneId: string) {
		return resolve('/a/[pane]', { pane: paneId });
	}
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
		<button
			class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-working"
			aria-label="New agent"
			title="New agent"
			onclick={onnew}>＋</button
		>
		<a
			href={resolve('/settings')}
			class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted"
			aria-label="Settings"
			title="Settings">☰</a
		>
	</div>

	<!--
		Workspaces on top, agents underneath — herdr's own shape. The top
		section chooses what the bottom one is about, which is what stops them
		being two views of the same list.
	-->
	<div class="max-h-[45%] min-h-0 overflow-y-auto border-b border-hairline py-1">
		<div class="flex items-center justify-between px-2 py-0.5">
			<span class="font-mono text-[10.5px] text-muted">workspaces</span>
			{#if prefs.value.workspaceFocus}
				<button
					class="font-mono text-[10.5px] text-working"
					onclick={() => prefs.set('workspaceFocus', '')}>show all</button
				>
			{/if}
		</div>

		{#each grouped as group (group.machine)}
			{#if group.machine}
				<p class="px-2 pt-1 font-mono text-[10.5px] text-working">{group.machine}</p>
			{/if}
			{#each group.workspaces as workspace (workspace.workspaceId)}
				{@const c = counts(workspace)}
				<button
					class="flex w-full items-center gap-2 px-2 py-1 text-left {workspace.workspaceId === focus
						? 'bg-chip'
						: ''}"
					aria-pressed={workspace.workspaceId === focus}
					onclick={() =>
						prefs.set(
							'workspaceFocus',
							prefs.value.workspaceFocus === workspace.workspaceId ? '' : workspace.workspaceId
						)}
				>
					<span
						class="h-1.5 w-1.5 shrink-0 rounded-full {c.blocked > 0
							? 'bg-blocked'
							: 'bg-idle-rail'}"
						aria-hidden="true"
					></span>
					<span class="min-w-0 flex-1 truncate text-[12.5px]"
						>{workspace.label || workspace.workspaceId}</span
					>
					<span class="shrink-0 font-mono text-[10px] text-faint">{c.agents}</span>
				</button>
			{/each}
		{/each}

		{#each pending as status (status.machine.id)}
			<div class="flex items-center gap-2 px-2 py-1 opacity-60">
				<span
					class="h-1.5 w-1.5 shrink-0 rounded-full {status.state === 'unreachable'
						? 'bg-idle-rail'
						: 'bg-working'}"
					aria-hidden="true"
				></span>
				<span class="min-w-0 flex-1 truncate font-mono text-[11px]">{status.machine.label}</span>
				<span class="shrink-0 font-mono text-[10px] text-faint" title={status.error ?? ''}
					>{status.state === 'unreachable' ? 'no answer' : 'connecting…'}</span
				>
			</div>
		{/each}
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto py-1">
		<div class="flex items-center gap-1 px-2 py-0.5">
			<span class="flex-1 font-mono text-[10.5px] text-muted">agents</span>
			{#each [{ v: 'priority', l: 'priority' }, { v: 'workspace', l: 'group' }] as option (option.v)}
				<button
					class="rounded px-1.5 py-0.5 font-mono text-[10px] {prefs.value.agentOrder === option.v
						? 'bg-chip text-ink'
						: 'text-faint'}"
					aria-pressed={prefs.value.agentOrder === option.v}
					onclick={() => prefs.set('agentOrder', option.v as AgentOrder)}>{option.l}</button
				>
			{/each}
		</div>

		{#if agentRows.length === 0}
			<p class="px-2 py-2 text-[12px] text-muted">Nothing here.</p>
		{/if}

		{#each agentRows as pane (pane.paneId)}
			<a
				href={paneHref(pane.paneId)}
				class="flex items-center gap-2 px-2 py-1 {pane.paneId === current ? 'bg-chip' : ''}"
				aria-current={pane.paneId === current ? 'page' : undefined}
			>
				<span
					class="h-1.5 w-1.5 shrink-0 rounded-full {pane.hasAgent
						? (STATUS_INK[pane.status] ?? 'bg-idle-rail')
						: 'bg-idle-rail'}"
					aria-hidden="true"
				></span>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-[12.5px]">{pane.title || pane.paneId}</span>
					{#if prefs.value.agentOrder === 'workspace' || !focus}
						<span class="block truncate font-mono text-[10px] text-faint"
							>{pane.workspaceLabel}</span
						>
					{/if}
				</span>
				<span
					class="shrink-0 font-mono text-[12px] {harnessText(pane.agent)}"
					title={pane.hasAgent ? pane.agent : 'shell'}
					aria-label={pane.hasAgent ? pane.agent : 'shell'}>{harnessIcon(pane.agent)}</span
				>
			</a>
		{/each}
	</div>

	<p class="border-t border-hairline px-2 py-1 font-mono text-[10px] text-faint">
		{allPanes.length} panes · {workspaces.length} workspaces
	</p>
</nav>
