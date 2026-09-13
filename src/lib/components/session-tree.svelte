<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from './icon.svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { agentTitle } from '$lib/grouping';
	import { agentStore } from '$lib/agents.svelte';
	import { prefs, type AgentOrder } from '$lib/prefs.svelte';
	import { harnessText } from '$lib/theme';
	import HarnessMark from './harness-mark.svelte';
	import PreviewText from './preview-text.svelte';
	import { tabName } from '$lib/tab-label';
	import StatusMark from './status-mark.svelte';
	import type { MachineStatus, PaneNode, WorkspaceNode } from '$lib/types';

	let {
		current = '',
		onnew = () => {},
		onclose,
		home = false
	}: {
		current?: string;
		onnew?: () => void;
		onclose?: () => void;
		/** Offer a way back to the agents list. Pointless on the agents list. */
		home?: boolean;
	} = $props();

	let workspaces = $state<WorkspaceNode[]>([]);
	let machines = $state<MachineStatus[]>([]);
	/**
	 * Machines herdr knows about that bordr has not been allowed to reach.
	 *
	 * Only ever populated when the reachable list is empty. bordr requires each
	 * host to be named in `BORDR_MACHINES` before it will connect — it has no
	 * login, so inheriting every host you ever typed into a terminal would make
	 * all of them drivable by anyone who reaches the app. That is the right
	 * default and a silent one: the sidebar simply stopped listing machines,
	 * with the reason in a file the app never mentions.
	 */
	let offered = $state<string[]>([]);

	async function load() {
		try {
			const res = await fetch('/api/panes');
			if (!res.ok) return;
			const body = await res.json();
			workspaces = body.workspaces ?? [];
			machines = body.machines ?? [];
			offered = body.offered ?? [];
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

	/**
	 * What each pane is actually doing, from the live agent list.
	 *
	 * `/api/panes` is the SHAPE of the session — machines, workspaces, tabs —
	 * and says nothing about the work. The preview, the branch and the drift
	 * all arrive over SSE on the agents list, which is already running, so
	 * joining the two here costs no request and no poll of its own.
	 *
	 * The store is reference-counted, so holding it from the tree is safe
	 * wherever the tree is mounted — including settings, where nothing else
	 * would have started it.
	 */
	$effect(() => {
		agentStore.start();
		return () => agentStore.stop();
	});

	const live = $derived(new Map(agentStore.agents.map((a) => [a.paneId, a])));

	/** Every pane, flattened, with the workspace and tab it came from. */
	interface Row extends PaneNode {
		workspaceLabel: string;
		tabLabel: string;
		machine: string;
	}

	const allPanes = $derived<Row[]>(
		workspaces.flatMap((w) =>
			w.tabs.flatMap((t) =>
				t.panes.map((p) => ({
					...p,
					workspaceLabel: w.label || w.workspaceId,
					// A default tab is labelled with its own number, which tells
					// you nothing the pane address has not already told you.
					tabLabel: /^\d+$/.test(tabName(t.label)) ? '' : tabName(t.label),
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
	/** Live fraction while dragging; null when the pref is in charge. */
	let dragSplit = $state<number | null>(null);
	const split = $derived(dragSplit ?? prefs.value.sidebarSplit);

	const clamp = (fraction: number) => Math.min(Math.max(fraction, 0.15), 0.75);

	/**
	 * Three things this has to get right, and it used to get none of them.
	 *
	 * `touch-action: none` on the handle, in CSS. `preventDefault()` on
	 * pointerdown does NOT stop a touch from scrolling — the browser decides
	 * that before the listener runs — so a finger on the handle scrolled the
	 * lists instead of resizing them.
	 *
	 * `pointercancel`, which is what fires when the browser takes the gesture
	 * over for a scroll. Listening only for `pointerup` meant the move handler
	 * stayed bound to the window for the life of the page: every later scroll,
	 * anywhere, resized the sidebar. That is the half of this that felt
	 * haunted rather than merely broken.
	 *
	 * And the fraction is held locally while dragging. `prefs.set` serialises
	 * the whole preferences object into localStorage, synchronously, and it
	 * was doing that on every pointermove.
	 */
	function startDrag(event: PointerEvent) {
		const host = shell;
		if (!host) return;
		event.preventDefault();
		const handle = event.currentTarget as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		const box = host.getBoundingClientRect();

		const move = (e: PointerEvent) => {
			dragSplit = clamp((e.clientY - box.top) / box.height);
		};
		const stop = () => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', stop);
			handle.removeEventListener('pointercancel', stop);
			if (dragSplit !== null) prefs.set('sidebarSplit', dragSplit);
			dragSplit = null;
		};
		// On the handle, not the window: pointer capture routes the whole drag
		// here, and a listener that cannot outlive its element cannot leak.
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', stop);
		handle.addEventListener('pointercancel', stop);
	}

	function paneHref(paneId: string) {
		return resolve('/a/[pane]', { pane: paneId });
	}
</script>

<!--
	The status indicator, in whichever form the setting asks for — the same
	choice herdr offers as `status_indicators`.

	A dot is the quietest and reads as a colour; a symbol adds a shape, so the
	list still sorts itself for anyone who does not separate red from green;
	the word is the most explicit and the widest. All three carry the same
	colour, and all three are one fixed-width cell so the titles beside them
	stay in a column whichever is on.
-->
{#snippet indicator(status: string, live: boolean)}
	<StatusMark {status} {live} />
{/snippet}

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
		<div class="flex shrink-0 items-center gap-2 border-b border-hairline px-2 py-1.5">
			<!--
				The same ☰, in the same corner, on every screen. The drawer covers
				the header, so the glyph that opened it has to be the glyph that
				closes it — a ✕ there reads as a different control, and anything
				that navigates there takes you somewhere you did not ask to go.
			-->
			<button
				class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted"
				aria-label="Close the session list"
				aria-expanded="true"
				onclick={onclose}>☰</button
			>
			{#if home && prefs.value.drawerHome !== 'off'}
				<!--
					The drawer covers the header, so the mark up there — which is already
					a link to the agents list — cannot be reached while this is open.
					This stands in for it, and defaults to being the same mark so the two
					read as one control rather than two ways home.
				-->
				<a
					href={resolve('/')}
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted"
					aria-label="Home — all agents"
					onclick={onclose}
				>
					{#if prefs.value.drawerHome === 'mark'}
						<img src="/collie.svg" alt="" class="h-7 w-7" style="image-rendering: pixelated" />
					{:else}
						<Icon name="home" size={20} />
					{/if}
				</a>
			{/if}
		</div>
	{/if}

	<!--
		Machines on top, agents underneath — herdr's own shape. The top section
		chooses what the bottom one is about, which is what stops them being two
		views of the same list.
	-->
	<div class="flex min-h-0 flex-col" style="height: {split * 100}%; flex: none">
		<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
			<p class="px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
				machines
			</p>

			{#each groups as group (group.key)}
				{@const folded = collapsed.has(group.key)}
				<button
					type="button"
					class="flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors hover:bg-chip/60"
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
							class="flex w-full items-center gap-2 border-l-2 py-1 pr-2 pl-3.5 transition-colors hover:bg-chip/60 {workspace.workspaceId ===
							currentWorkspace
								? 'border-l-working bg-chip'
								: 'border-l-transparent'}"
							aria-current={workspace.workspaceId === currentWorkspace ? 'true' : undefined}
						>
							{@render indicator(c.blocked > 0 ? 'blocked' : 'idle', true)}
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[12.5px]"
									>{workspace.label || workspace.workspaceId}</span
								>
								{#if workspace.branch && prefs.value.showBranches}
									<span class="block truncate font-mono text-[10px] text-branch">
										&#xe0a0; {workspace.branch}{#if workspace.ahead}<span class="text-ahead"
												>&nbsp;&uarr;{workspace.ahead}</span
											>{/if}{#if workspace.behind}<span class="text-behind"
												>&nbsp;&darr;{workspace.behind}</span
											>{/if}
									</span>
								{/if}
							</span>
							<span class="shrink-0 font-mono text-[10px] text-faint">{c.agents}</span>
						</a>
					{/each}
				{/if}
			{/each}
		</div>

		{#if offered.length > 0}
			<!--
				Names the hosts and names the fix. "Where are my other machines" is a
				real question and the honest answer is short.
			-->
			<p class="shrink-0 border-t border-hairline px-2 py-1.5 text-[10.5px] text-muted">
				{offered.join(', ')} configured in herdr, not reachable from here.
				<span class="text-faint"
					>bordr only inherits herdr's machines while it is bound to loopback or a tailnet. Name {offered.length ===
					1
						? 'it'
						: 'them'} in <span class="font-mono">BORDR_MACHINES</span> to reach {offered.length ===
					1
						? 'it'
						: 'them'} anyway.</span
				>
			</p>
		{/if}

		<!-- herdr keeps new and menu at the foot of its machines pane, not in a title bar. -->
		<div class="flex shrink-0 items-center gap-1 border-t border-hairline px-2 py-1">
			<button
				class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-edge px-2 py-1.5 font-mono text-[10.5px] text-working transition-colors hover:bg-chip"
				onclick={onnew}><Icon name="plus" size={13} /> new</button
			>
			<!--
				flex-1 on both, so the pair splits the row evenly rather than one
				sizing to its own text and leaving the other to take the rest.
			-->
			<a
				href={resolve('/settings')}
				class="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-edge px-2 py-1.5 font-mono text-[10.5px] text-muted transition-colors hover:bg-chip"
				><Icon name="settings" size={14} /> settings</a
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
			split * 100
		)}% — arrow keys adjust"
		class="group relative h-1.5 w-full shrink-0 cursor-row-resize touch-none border-y border-hairline bg-card before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']"
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

	<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
		<div class="flex items-center gap-1 px-2 py-0.5">
			<span class="flex-1 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">agents</span
			>
			<!-- One control with two positions, rather than two chips that happen
			     to be adjacent — it is a single choice and should look like it. -->
			<span class="flex gap-px rounded-md bg-chip p-px" role="group" aria-label="Order agents by">
				{#each [{ v: 'priority', l: 'priority' }, { v: 'workspace', l: 'group' }] as option (option.v)}
					<!--
						Equal width, not text width: "priority" is twice the length of
						"group", so sizing to content made the selected half jump about
						as you switched. A fixed cell each keeps the control still.
					-->
					<button
						class="w-[52px] rounded-[5px] py-0.5 font-mono text-[10px] transition-colors {prefs
							.value.agentOrder === option.v
							? 'bg-card text-ink shadow-sm'
							: 'text-faint hover:text-muted'}"
						aria-pressed={prefs.value.agentOrder === option.v}
						onclick={() => prefs.set('agentOrder', option.v as AgentOrder)}>{option.l}</button
					>
				{/each}
			</span>
		</div>

		{#if agentRows.length === 0}
			<p class="px-2 py-2 text-[12px] text-muted">Nothing here.</p>
		{/if}

		{#each agentRows as pane (pane.paneId)}
			{@const info = live.get(pane.paneId)}
			<a
				href={paneHref(pane.paneId)}
				class="flex items-start gap-2 border-l-2 py-1 pr-2 pl-1.5 transition-colors hover:bg-chip/60 {pane.paneId ===
				current
					? 'border-l-working bg-chip'
					: 'border-l-transparent'}"
				aria-current={pane.paneId === current ? 'page' : undefined}
			>
				<span class="mt-[6px] flex shrink-0 items-center"
					>{@render indicator(pane.status, pane.hasAgent)}</span
				>
				<span class="min-w-0 flex-1">
					<span class="block truncate text-[12.5px]"
						>{agentTitle(pane.title, pane.workspaceLabel, pane.paneId, pane.agent)}</span
					>
					<!--
						Where the agent is, always — herdr's own list carries the
						workspace on every row. Showing it only under one sort order
						meant the priority list, the one you look at when something
						needs you, was the one that would not say where to go.

						The branch shares this line and holds its width while the
						workspace gives way, the same bargain the agents list and the
						conversation header both make: a workspace name cut short is
						still recognisable, a branch cut short is not.
					-->
					<span class="flex items-baseline gap-x-1 font-mono text-[10px] text-faint">
						<!--
							The tab name last, and inside the SAME truncating span, so a
							long one gives way before the workspace does — herdr's own
							row makes the same trade.
						-->
						<span class="min-w-0 truncate"
							>{pane.machine ? `${pane.machine} · ` : ''}{pane.workspaceLabel}{prefs.value
								.showTabName && pane.tabLabel
								? ` · ${pane.tabLabel}`
								: ''}</span
						>
						{#if info?.branch}
							<span class="max-w-[55%] shrink-0 truncate text-branch">&#xe0a0; {info.branch}</span>
							{#if info.ahead}<span class="shrink-0 text-ahead">&uarr;{info.ahead}</span>{/if}
							{#if info.behind}<span class="shrink-0 text-behind">&darr;{info.behind}</span>{/if}
						{/if}
					</span>
					{#if info?.preview}
						<!--
							What it is doing, which is the one thing the tree could not
							say. A pane that is `working` looked exactly like every
							other working pane; now the row says what the work is.
						-->
						<span class="mt-px block truncate text-[10.5px] text-muted"
							><PreviewText text={info.preview} /></span
						>
					{/if}
				</span>
				<span
					class="mt-[2px] shrink-0 font-mono text-[12px] {harnessText(pane.agent)}"
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
