<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from './icon.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { agentTitle } from '$lib/grouping';
	import { prefs, type AgentOrder } from '$lib/prefs.svelte';
	import { STATUS_RAIL, harnessText } from '$lib/theme';
	import HarnessMark from './harness-mark.svelte';
	import type { MachineStatus, PaneNode, WorkspaceNode } from '$lib/types';

	let {
		current = '',
		onnew = () => {},
		onclose
	}: { current?: string; onnew?: () => void; onclose?: () => void } = $props();

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

	const RANK: Record<string, number> = { blocked: 0, working: 1, done: 2, idle: 3, unknown: 4 };

	/**
	 * The agent section: agents, ordered by whichever rule is chosen.
	 *
	 * Panes with no agent are left out. A section called "agents" is a list of
	 * things that might need you, and a shell never does — it sat there
	 * outnumbering them, one row per terminal, pushing the ones that do off
	 * the screen. Shells are reached where they live: the machines section
	 * above, and the pane strip inside their own tab.
	 */
	const agentRows = $derived.by(() => {
		return allPanes
			.filter((p) => p.hasAgent)
			.sort((a, b) => {
				if (prefs.value.agentOrder === 'workspace') {
					return a.workspaceLabel.localeCompare(b.workspaceLabel) || a.title.localeCompare(b.title);
				}
				return (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.title.localeCompare(b.title);
			});
	});

	/**
	 * The machines section: one collapsible group per machine, this host first.
	 *
	 * A machine that is connecting or unreachable still gets its group, so it
	 * keeps its place in the list and says what it is doing — it used to drop
	 * out of the tree entirely and reappear at the bottom as a stray row.
	 */
	interface MachineGroup {
		key: string;
		label: string;
		state: MachineStatus['state'] | 'local';
		error: string;
		workspaces: WorkspaceNode[];
	}

	const groups = $derived.by((): MachineGroup[] => {
		const local: MachineGroup = {
			key: '',
			label: 'Local',
			state: 'local',
			error: '',
			workspaces: workspaces.filter((w) => !w.machine)
		};
		const remote = machines.map((m) => ({
			key: m.machine.label,
			label: m.machine.label,
			state: m.state,
			error: m.error ?? '',
			workspaces: workspaces.filter((w) => w.machine === m.machine.label)
		}));
		return [local, ...remote.sort((a, b) => a.label.localeCompare(b.label))];
	});

	/** Groups the user has folded away. Collapsed is the exception, so a set of keys. */
	const collapsed = new SvelteSet<string>();

	function toggle(key: string) {
		if (!collapsed.delete(key)) collapsed.add(key);
	}

	function counts(workspace: WorkspaceNode) {
		const panes = workspace.tabs.flatMap((t) => t.panes);
		return {
			agents: panes.filter((p) => p.hasAgent).length,
			blocked: panes.filter((p) => p.status === 'blocked').length
		};
	}

	/**
	 * Where a workspace row goes: its first agent, or its first pane. Opening
	 * a shell when the workspace has an agent in it is the wrong landing.
	 */
	function workspaceTarget(workspace: WorkspaceNode): string {
		const panes = workspace.tabs.flatMap((t) => t.panes);
		return (panes.find((p) => p.hasAgent) ?? panes[0])?.paneId ?? '';
	}

	/**
	 * The divider between the sections.
	 *
	 * Pointer events rather than mouse ones, so a finger drags it too, and
	 * capture so the drag survives the pointer leaving the 6px handle. The
	 * fraction is clamped in prefs on the way in and out, so neither section
	 * can be dragged to nothing.
	 */
	let shell = $state<HTMLElement | undefined>();

	function startDrag(event: PointerEvent) {
		const host = shell;
		if (!host) return;
		event.preventDefault();
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
		const box = host.getBoundingClientRect();

		const move = (e: PointerEvent) => {
			const fraction = (e.clientY - box.top) / box.height;
			prefs.set('sidebarSplit', Math.min(Math.max(fraction, 0.15), 0.75));
		};
		const stop = (e: PointerEvent) => {
			(event.target as HTMLElement).releasePointerCapture(e.pointerId);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', stop);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', stop);
	}

	function paneHref(paneId: string) {
		return resolve('/a/[pane]', { pane: paneId });
	}
</script>

<nav
	bind:this={shell}
	class="flex h-full flex-col border-r border-hairline bg-card"
	aria-label="Session"
>
	<!--
		Only as a drawer, where `onclose` is passed. The desktop sidebar is always
		there and has the header's own mark to go home with, so a row of buttons
		above it would be two controls for one job.

		Tapping the exposed screen already closes the drawer, but that is a target
		you have to know about: it is unlabelled, invisible to a screen reader as
		anything but "Close the session list", and not reachable by keyboard in
		any obvious order. An explicit button is the accessible way out.
	-->
	{#if onclose}
		<div class="flex shrink-0 items-center gap-1 border-b border-hairline px-2 py-1.5">
			<a
				href={resolve('/')}
				class="flex h-11 min-w-11 items-center gap-2 rounded-lg px-2 text-[13px] text-muted"
				onclick={onclose}
			>
				<Icon name="list" size={20} />
				All agents
			</a>
			<span class="flex-1"></span>
			<button
				class="flex h-11 w-11 items-center justify-center rounded-lg text-[17px] text-muted"
				aria-label="Close the session list"
				onclick={onclose}>✕</button
			>
		</div>
	{/if}

	<!--
		Machines on top, agents underneath — herdr's own shape. The top section
		chooses what the bottom one is about, which is what stops them being two
		views of the same list.
	-->
	<div class="flex min-h-0 flex-col" style="height: {prefs.value.sidebarSplit * 100}%; flex: none">
		<div class="min-h-0 flex-1 overflow-y-auto py-1">
			<p class="px-2 py-0.5 font-mono text-[10.5px] text-muted">machines</p>

			{#each groups as group (group.key)}
				{@const folded = collapsed.has(group.key)}
				<button
					type="button"
					class="flex w-full items-center gap-1.5 px-2 py-1 text-left"
					aria-expanded={!folded}
					onclick={() => toggle(group.key)}
				>
					<span class="w-2 shrink-0 font-mono text-[9px] text-faint" aria-hidden="true"
						>{folded ? '▶' : '▼'}</span
					>
					<span class="min-w-0 flex-1 truncate font-mono text-[11px] text-working"
						>{group.label}</span
					>
					{#if group.state === 'unreachable'}
						<span class="shrink-0 font-mono text-[10px] text-faint" title={group.error}
							>no answer</span
						>
					{:else if group.state === 'connecting'}
						<span class="shrink-0 font-mono text-[10px] text-faint">connecting…</span>
					{:else}
						<span class="shrink-0 font-mono text-[10px] text-faint">{group.workspaces.length}</span>
					{/if}
				</button>

				{#if !folded}
					{#each group.workspaces as workspace (workspace.workspaceId)}
						{@const c = counts(workspace)}
						<a
							href={paneHref(workspaceTarget(workspace))}
							class="flex w-full items-center gap-2 py-1 pr-2 pl-4 text-left {workspace.workspaceId ===
							currentWorkspace
								? 'bg-chip'
								: ''}"
							aria-current={workspace.workspaceId === currentWorkspace ? 'true' : undefined}
						>
							<span
								class="h-1.5 w-1.5 shrink-0 rounded-full {c.blocked > 0
									? 'bg-blocked'
									: 'bg-idle-rail'}"
								aria-hidden="true"
							></span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[12.5px]"
									>{workspace.label || workspace.workspaceId}</span
								>
								{#if workspace.branch && prefs.value.showBranches}
									<span class="block truncate font-mono text-[10px] text-faint"
										>&#xe0a0; {workspace.branch}</span
									>
								{/if}
							</span>
							<span class="shrink-0 font-mono text-[10px] text-faint">{c.agents}</span>
						</a>
					{/each}
				{/if}
			{/each}
		</div>

		<!-- herdr keeps new and menu at the foot of its machines pane, not in a title bar. -->
		<div class="flex shrink-0 items-center gap-1 border-t border-hairline px-2 py-1">
			<button
				class="flex-1 rounded px-1.5 py-0.5 text-left font-mono text-[10.5px] text-working"
				onclick={onnew}>new · Local</button
			>
			<a
				href={resolve('/settings')}
				class="rounded px-1.5 py-0.5 font-mono text-[10.5px] text-muted">menu</a
			>
		</div>
	</div>

	<!--
		The handle between the sections.

		A button rather than a `role="separator"`: a focusable separator with
		aria-valuenow is the correct window-splitter pattern, but svelte-check
		treats every separator as decorative and warns either way. A button is
		announced as the control it is, keeps the keyboard, and leaves the
		build clean — the value is in the label instead of aria-valuenow.
	-->
	<button
		type="button"
		aria-label="Resize the machines section, currently {Math.round(
			prefs.value.sidebarSplit * 100
		)}% — arrow keys adjust"
		class="group relative h-1.5 w-full shrink-0 cursor-row-resize border-y border-hairline bg-card before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']"
		onpointerdown={startDrag}
		onkeydown={(e) => {
			// Keyboard-resizable too, in 5% steps.
			if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
			e.preventDefault();
			const next = prefs.value.sidebarSplit + (e.key === 'ArrowDown' ? 0.05 : -0.05);
			prefs.set('sidebarSplit', Math.min(Math.max(next, 0.15), 0.75));
		}}
	>
		<span
			class="pointer-events-none absolute inset-x-0 top-1/2 mx-auto h-[2px] w-8 -translate-y-1/2 rounded-full bg-edge group-hover:bg-working"
		></span>
	</button>

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
				<!--
					STATUS_RAIL, not STATUS_INK: the ink map is text colours, so a
					dot carrying `text-working` painted nothing at all and every
					agent in this list looked idle.
				-->
				<span
					class="h-1.5 w-1.5 shrink-0 rounded-full {pane.hasAgent
						? (STATUS_RAIL[pane.status] ?? 'bg-idle-rail')
						: 'bg-edge'}"
					aria-hidden="true"
				></span>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-[12.5px]"
						>{agentTitle(pane.title, pane.workspaceLabel, pane.paneId, pane.agent)}</span
					>
					<!--
						Where the agent is, always — herdr's own list carries the
						workspace on every row. Showing it only under one sort order
						meant the priority list, the one you look at when something
						needs you, was the one that would not say where to go.
					-->
					<span class="block truncate font-mono text-[10px] text-faint"
						>{pane.machine ? `${pane.machine} · ` : ''}{pane.workspaceLabel}</span
					>
				</span>
				<span
					class="shrink-0 font-mono text-[12px] {harnessText(pane.agent)}"
					title={pane.hasAgent ? pane.agent : 'shell'}
					aria-label={pane.hasAgent ? pane.agent : 'shell'}><HarnessMark agent={pane.agent} /></span
				>
			</a>
		{/each}
	</div>

	<p class="border-t border-hairline px-2 py-1 font-mono text-[10px] text-faint">
		{allPanes.length} panes · {workspaces.length} workspaces
	</p>
</nav>
