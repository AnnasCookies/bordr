<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { version } from '$app/environment';
	import { resolve } from '$app/paths';
	import { agentStore } from '$lib/agents.svelte';
	import { prefs, type GroupBy } from '$lib/prefs.svelte';
	import { collapseHome, partitionAgents, rollupCounts } from '$lib/grouping';
	import { harnessText, STATUS_INK, STATUS_RAIL } from '$lib/theme';
	import AgentRow from '$lib/components/agent-row.svelte';
	import ConnectionBanner from '$lib/components/connection-banner.svelte';
	import AppHeader from '$lib/components/app-header.svelte';
	import Icon from '$lib/components/icon.svelte';
	import TabBar from '$lib/components/tab-bar.svelte';
	import NewAgentSheet from '$lib/components/new-agent-sheet.svelte';
	import SessionTree from '$lib/components/session-tree.svelte';
	import { checkPush, togglePushDetailed, type PushState } from '$lib/push-client';
	import type { AgentSummary } from '$lib/types';

	const store = agentStore;
	/**
	 * The workspaces drawer, from the agents list.
	 *
	 * The tree only existed on a conversation, so on a phone the machines and
	 * their workspaces were unreachable until you had opened an agent — and a
	 * shell pane, which is not an agent, could not be reached at all.
	 */
	let treeOpen = $state(false);

	/**
	 * Hold the page still while the drawer is over it. Same reason as the pane
	 * page: the drawer is `fixed inset-0` and scrolls nothing itself, so a drag
	 * on it scrolled the list underneath and moved the phone's own chrome,
	 * which changes the height the drawer is pinned to.
	 */
	$effect(() => {
		if (!treeOpen) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});
	/**
	 * A picture shared into bordr from another app.
	 *
	 * The Android share sheet cannot know which agent you meant, so /share
	 * stashes the file and sends you here to choose. The names travel on to
	 * the conversation, which attaches them.
	 */
	const shared = $derived(page.url.searchParams.get('shared') ?? '');
	const sharedText = $derived(page.url.searchParams.get('text') ?? '');
	const sharedCount = $derived(shared ? shared.split(',').filter(Boolean).length : 0);
	const query = $derived(shared ? `?${page.url.searchParams}` : '');
	let pushState = $state<PushState>('unknown');
	/** Why the bell did not turn on, shown under the header rather than alert()ed. */
	let pushMessage = $state<string | null>(null);
	/** Set while an inline answer is in flight, so the row cannot double-fire. */
	let answering = $state('');
	let showNew = $state(false);
	/** paneId → what went wrong with the last inline answer, shown for a while. */
	let uncertain = $state<Record<string, string>>({});

	onMount(() => {
		store.start();
		void checkPush().then((s) => (pushState = s));
		return () => store.stop();
	});

	const blocked = $derived(store.agents.filter((a) => a.status === 'blocked').length);
	const working = $derived(store.agents.filter((a) => a.status === 'working').length);
	const split = $derived(partitionAgents(store.agents, prefs.value.groupBy, prefs.value.sort));
	const rollup = $derived(rollupCounts(store.agents));

	function unread(agent: AgentSummary): boolean {
		return (store.read[agent.paneId] ?? 0) < agent.seq && agent.status !== 'working';
	}

	/** The handoff's preview line, with the cwd standing in until it exists. */
	function previewOf(agent: AgentSummary): string {
		if (prefs.value.preview === 'none') return '';
		if (prefs.value.preview === 'cwd') return collapseHome(agent.cwd);
		return agent.preview || collapseHome(agent.cwd);
	}

	async function onTogglePush() {
		const { state, message } = await togglePushDetailed(pushState);
		pushState = state;
		pushMessage = message;
	}

	function flagAnswer(paneId: string, text: string) {
		uncertain = { ...uncertain, [paneId]: text };
		setTimeout(() => {
			const rest = { ...uncertain };
			delete rest[paneId];
			uncertain = rest;
		}, 10_000);
	}

	async function answer(agent: AgentSummary, index: number) {
		answering = agent.paneId;
		try {
			const response = await fetch(`/api/agents/${encodeURIComponent(agent.paneId)}/answer`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ index })
			});
			const body = (await response.json().catch(() => null)) as {
				outcome?: string;
				message?: string;
			} | null;
			// Three distinct stories, and the reader needs to know which: the
			// server refused it (the option was not on screen), it was sent but
			// only the screen can confirm the menu moved, or nothing left the
			// phone at all — that last one is the only safe one to retry.
			if (!response.ok) {
				flagAnswer(agent.paneId, body?.message ?? `Could not answer (${response.status}).`);
			} else if (body?.outcome === 'unknown') {
				flagAnswer(agent.paneId, 'Sent, but the screen did not confirm it.');
			}
		} catch {
			flagAnswer(agent.paneId, 'Nothing was sent — check the connection and try again.');
		}
		answering = '';
	}

	const GROUP_CHIPS: Array<{ v: GroupBy; l: string }> = [
		{ v: 'workspace', l: 'Workspace' },
		{ v: 'status', l: 'Status' },
		{ v: 'harness', l: 'Harness' },
		{ v: 'none', l: 'None' }
	];
</script>

<div class="flex min-h-dvh flex-col">
	{#snippet listStatus()}
		{#if blocked > 0}
			<span class="rounded-md bg-blocked-bg px-2 py-[3px] text-xs font-medium text-blocked-ink">
				{blocked} blocked
			</span>
		{:else if working > 0}
			<span class="rounded-md bg-working-bg px-2 py-[3px] text-xs font-medium text-working">
				{working} working
			</span>
		{/if}
	{/snippet}

	{#snippet listActions()}
		{#if store.connection === 'reconnecting'}
			<!-- A blip gets a spinner, not a banner: it recovers in about a second
			     and saying "unreachable" every time made a healthy app look broken. -->
			<span
				class="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-hairline border-t-faint motion-safe:animate-spin"
				role="status"
				aria-label="Reconnecting"
			></span>
		{/if}
		{#if pushState !== 'unsupported'}
			<button
				class="flex h-9 w-9 items-center justify-center {pushState === 'on'
					? 'text-done'
					: 'text-faint'}"
				aria-label={pushState === 'on' ? 'Disable notifications' : 'Enable notifications'}
				onclick={onTogglePush}
			>
				<Icon name="bell" size={18} />
			</button>
		{/if}
	{/snippet}

	<header class="border-b border-hairline">
		<AppHeader
			onmenu={() => (treeOpen = !treeOpen)}
			menuLabel="Workspaces"
			menuExpanded={treeOpen}
			middle={listStatus}
			actions={listActions}
		/>
	</header>

	{#if pushMessage}
		<p
			role="status"
			class="mx-4 mb-2 flex items-start gap-2 rounded-[10px] bg-danger-bg px-3 py-2.5 text-[12.5px] text-danger-ink"
		>
			<span class="min-w-0 flex-1">{pushMessage}</span>
			<button class="shrink-0 underline" onclick={() => (pushMessage = null)}>Dismiss</button>
		</p>
	{/if}

	<ConnectionBanner connection={store.connection} compat={store.compat} />

	<main class="flex-1 px-4 pb-24">
		{#if prefs.value.rollup && store.agents.length > 0}
			<div
				class="mb-3 grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-hairline bg-black/[.07] dark:bg-white/[.07]"
			>
				{#if sharedCount > 0}
					<div class="mb-2 rounded-xl border border-working bg-working-bg px-3 py-2 text-[13px]">
						<p class="font-medium">
							{sharedCount === 1 ? 'Photo shared' : `${sharedCount} photos shared`} — pick an agent to
							send
							{sharedCount === 1 ? 'it' : 'them'} to.
						</p>
						{#if sharedText}
							<p class="mt-0.5 truncate text-[12px] text-muted">{sharedText}</p>
						{/if}
					</div>
				{/if}

				{#each rollup as cell (cell.status)}
					<div class="px-3 pt-3 pb-2.5 {cell.status === 'blocked' ? 'bg-blocked-bg' : 'bg-card'}">
						<div
							class="font-mono text-[22px] leading-none {cell.status === 'blocked'
								? 'text-blocked-ink'
								: (STATUS_INK[cell.status] ?? '')}"
						>
							{cell.n}
						</div>
						<div
							class="mt-1.5 text-[11px] {cell.status === 'blocked'
								? 'text-blocked-ink'
								: 'text-muted'}"
						>
							{cell.status}
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if prefs.value.showGrouping}
			<div class="mb-3 flex flex-wrap gap-1.5">
				{#each GROUP_CHIPS as chip (chip.v)}
					<button
						class="rounded-full px-2.5 py-1.5 text-xs {prefs.value.groupBy === chip.v
							? 'bg-ink text-card'
							: 'bg-chip text-muted'}"
						onclick={() => prefs.set('groupBy', chip.v)}
					>
						{chip.l}
					</button>
				{/each}
			</div>
		{/if}

		{#if split.blocked.length > 0}
			<div class="mb-1.5 flex items-center gap-2">
				<h2 class="font-mono text-[11px] text-blocked-ink">needs you</h2>
				<span class="h-px flex-1 bg-blocked-edge"></span>
			</div>
			<ul class="mb-4 flex flex-col gap-1.5">
				{#each split.blocked as agent (agent.paneId)}
					<li class="overflow-hidden rounded-xl border border-blocked-edge bg-blocked-surface">
						<div class="flex">
							<span class="w-1 shrink-0 self-stretch bg-blocked"></span>
							<div class="min-w-0 flex-1 px-3 py-[11px]">
								<a href={resolve('/a/[pane]', { pane: agent.paneId })} class="block min-w-0">
									<span class="flex items-baseline gap-2">
										<span class="min-w-0 flex-1 truncate text-[15px] font-medium">
											{agent.title || agent.paneId}
										</span>
										<span class="shrink-0 font-mono text-[10.5px] text-blocked-ink">blocked</span>
									</span>
									<span class="mt-[3px] block truncate font-mono text-[11px] text-muted">
										<span class={harnessText(agent.agent)}>{agent.agent}</span> · {collapseHome(
											agent.cwd
										)}
									</span>
								</a>

								{#if agent.picker?.options?.length}
									{#if agent.picker.question}
										<p class="mt-2 text-[13.5px]">{agent.picker.question}</p>
									{/if}
									<div class="mt-2 flex flex-wrap gap-1.5">
										{#each agent.picker.options.slice(0, 3) as option, i (option.index)}
											<button
												class="rounded-[7px] px-3.5 py-2 text-[12.5px] disabled:opacity-50 {i === 0
													? 'bg-ink text-card'
													: 'bg-chip text-ink'}"
												disabled={answering === agent.paneId}
												onclick={() => answer(agent, option.index)}
											>
												{option.index}. {option.label}
											</button>
										{/each}
										{#if agent.picker.options.length > 3}
											<a
												href={resolve('/a/[pane]', { pane: agent.paneId })}
												class="rounded-[7px] bg-chip px-3.5 py-2 text-[12.5px] text-ink">Open</a
											>
										{/if}
									</div>
								{:else}
									<p class="mt-2 font-mono text-[11px] text-muted">waiting on you</p>
								{/if}

								{#if uncertain[agent.paneId]}
									<p
										role="status"
										class="mt-2 rounded-lg border border-blocked-edge bg-blocked-bg px-2.5 py-1.5 text-[12.5px] text-blocked-ink"
									>
										<span class="font-mono">!</span>
										{uncertain[agent.paneId]}
									</p>
								{/if}
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#each split.groups as group (group.key)}
			{#if group.left}
				<div class="mt-4 mb-1.5 flex items-center gap-2 first:mt-0">
					<h2
						class="shrink-0 font-mono text-[11px] {group.status
							? (STATUS_INK[group.status] ?? 'text-ink')
							: group.agent
								? harnessText(group.agent)
								: 'text-ink'}"
					>
						{group.left}
					</h2>
					<span
						class="h-px min-w-3 flex-1 {group.status
							? (STATUS_RAIL[group.status] ?? 'bg-hairline')
							: 'bg-hairline'} {group.status ? 'opacity-25' : ''}"
					></span>
					{#if group.right}
						<!-- Must be allowed to shrink: a deep cwd otherwise pushes the
						     header past the viewport instead of ellipsising. -->
						<span class="min-w-0 truncate font-mono text-[11px] text-muted">{group.right}</span>
					{/if}
				</div>
			{/if}
			<ul class="flex flex-col gap-1.5">
				{#each group.agents as agent (agent.paneId)}
					<li><AgentRow {agent} unread={unread(agent)} preview={previewOf(agent)} {query} /></li>
				{/each}
			</ul>
		{/each}

		{#if store.agents.length === 0}
			{#if store.connection === 'reconnecting'}
				<!-- Skeletons, not a spinner: the rows arrive on the first SSE event.
				     Only while that event is still plausibly on its way — once the
				     stream is declared silent or down the banner says so, and rows
				     that never fill in would contradict it. -->
				<ul class="flex flex-col gap-1.5" aria-hidden="true">
					{#each [0, 1, 2] as n (n)}
						<li class="flex overflow-hidden rounded-xl border border-hairline bg-card">
							<span class="w-1 shrink-0 self-stretch bg-chip"></span>
							<span class="flex-1 px-3 py-[11px]">
								<span class="block h-3.5 w-2/5 rounded bg-chip"></span>
								<span class="mt-2 block h-2.5 w-3/5 rounded bg-chip"></span>
							</span>
						</li>
					{/each}
				</ul>
			{:else if store.connected && store.compat?.level !== 'unreachable'}
				<!-- With herdr down the list is empty because nothing can be read,
				     not because nothing is running; the + button would only fail. -->
				<div
					class="mt-8 flex flex-col items-center gap-2 rounded-xl border border-dashed border-edge px-6 py-10 text-center"
				>
					<img
						src="/patrl-face.png"
						alt=""
						class="h-10 w-10 opacity-80"
						style="image-rendering: pixelated"
					/>
					<p class="text-[15px] font-semibold">No agents running</p>
					<p class="text-[13px] text-muted">Start one with the + button.</p>
				</div>
			{/if}
		{/if}

		<p class="py-6 text-center text-[10px] text-faint">build {version}</p>
	</main>

	<button
		class="fixed right-4 z-30 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-ink text-card shadow-[0_8px_20px_rgba(0,0,0,.2)]"
		style="bottom: calc(env(safe-area-inset-bottom) + 4.5rem)"
		aria-label="New agent"
		onclick={() => (showNew = true)}
	>
		<Icon name="plus" size={24} />
	</button>

	{#if treeOpen}
		<div class="fixed inset-0 z-40">
			<!--
				Presentational: the drawer's own ☰ is the labelled control, so
				announcing this as a second way to close it would put two buttons
				with the same job in the accessibility tree.
			-->
			<button
				class="absolute inset-0 bg-black/40"
				aria-hidden="true"
				tabindex="-1"
				onclick={() => (treeOpen = false)}
			></button>
			<div class="absolute inset-y-0 left-0 w-[86%] max-w-[320px] shadow-2xl">
				<SessionTree
					onclose={() => (treeOpen = false)}
					onnew={() => {
						treeOpen = false;
						showNew = true;
					}}
				/>
			</div>
		</div>
	{/if}

	<NewAgentSheet open={showNew} onclose={() => (showNew = false)} />

	<TabBar />
</div>
