<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto, replaceState } from '$app/navigation';
	import { version } from '$app/environment';
	import { resolve } from '$app/paths';
	import { agentStore } from '$lib/agents.svelte';
	import { prefs, type GroupBy } from '$lib/prefs.svelte';
	import {
		answerSettled,
		collapseHome,
		holdsAnswer,
		partitionAgents,
		pickerKey,
		rollupCounts,
		type AnsweredMark
	} from '$lib/grouping';
	import { harnessText, STATUS_INK, STATUS_RAIL } from '$lib/theme';
	import AgentRow from '$lib/components/agent-row.svelte';
	import ConnectionBanner from '$lib/components/connection-banner.svelte';
	import InstallPrompt from '$lib/components/install-prompt.svelte';
	import AppHeader from '$lib/components/app-header.svelte';
	import Icon from '$lib/components/icon.svelte';
	import Spinner from '$lib/components/spinner.svelte';
	import Ticks from '$lib/components/ticks.svelte';
	import { track } from '$lib/pending.svelte';
	import TabBar from '$lib/components/tab-bar.svelte';
	import NewAgentSheet from '$lib/components/new-agent-sheet.svelte';
	import SessionTree from '$lib/components/session-tree.svelte';
	import SidebarResizer from '$lib/components/sidebar-resizer.svelte';
	import { DEFAULT_SIDEBAR } from '$lib/sidebar';
	import { checkPush, togglePushDetailed, type PushState } from '$lib/push-client';
	import { screen, watchWide } from '$lib/wide.svelte';
	import type { AgentStatus, AgentSummary } from '$lib/types';

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
	/**
	 * Which option is in flight, as `paneId#index`.
	 *
	 * The option, not just the pane: the row already could not double-fire,
	 * but every button on it went half-transparent together, which reads as
	 * "these went grey" rather than as "this one is being sent". The tapped
	 * one now carries a spinner and the rest simply wait.
	 */
	let answering = $state('');
	/**
	 * Which option, not just which agent. Dimming all three said "something is
	 * happening"; it did not say which one you had chosen, and on a slow round
	 * trip that is the only thing you want to know.
	 */
	let answeringIndex = $state(-1);
	let showNew = $state(false);

	/**
	 * The manifest's "New agent" shortcut lands here with `?new=1`.
	 *
	 * A long press on the installed icon offers it, so it has to do something
	 * on arrival rather than just opening the list. The parameter is stripped
	 * straight away: leaving it in the URL would reopen the sheet on every
	 * back-navigation to the list for the rest of the session.
	 */
	$effect(() => {
		if (page.url.searchParams.get('new') !== '1') return;
		showNew = true;
		const clean = new URL(page.url);
		clean.searchParams.delete('new');
		// `replaceState`, not `goto`: nothing is being navigated to. The URL is
		// simply losing a parameter it has already been acted on.
		// The rule wants `resolve()` as the bare argument, which would mean
		// dropping the rest of the query — and a share arriving at the same time
		// carries `shared` and `text` there. The route is this page's own, and
		// only a parameter is being removed from it.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(`${resolve('/')}${clean.search}`, page.state);
	});
	/** paneId → what went wrong with the last inline answer, shown for a while. */
	let uncertain = $state<Record<string, string>>({});

	/**
	 * Questions already answered from here, as paneId → the question and its
	 * options, kept until the list stops reporting them.
	 *
	 * The picker is read off the terminal screen, so it outlives the answer by
	 * however long the next read takes. Without this the buttons came back
	 * looking like a fresh unanswered question — and answering it again sends
	 * a second keystroke.
	 *
	 * Keyed on the question itself so the NEXT question is never swallowed,
	 * and held for a bounded time so a card cannot go missing for good if the
	 * screen does not move after all.
	 *
	 * Single-select only. A tap on a checkbox picker toggles one box and the
	 * question stays open, so holding it would take away the very buttons
	 * needed to tick a second option — see `holdsAnswer`.
	 */
	let answered = $state<Record<string, AnsweredMark>>({});
	const ANSWERED_HOLD_MS = 8_000;
	let clock = $state(Date.now());
	$effect(() => {
		if (Object.keys(answered).length === 0) return;
		const timer = setInterval(() => {
			clock = Date.now();
			// Expired marks are dropped rather than left to go stale, so the map
			// empties, this effect re-runs, and the timer stops. Without it a
			// single answer left a half-second tick running for as long as the
			// list stayed open.
			const live = Object.entries(answered).filter(([, m]) => clock - m.at < ANSWERED_HOLD_MS);
			if (live.length !== Object.keys(answered).length) answered = Object.fromEntries(live);
		}, 500);
		return () => clearInterval(timer);
	});

	/** Has this exact question already been answered, and not yet cleared? */
	function settled(agent: AgentSummary): boolean {
		return answerSettled(answered[agent.paneId], agent.picker, clock, ANSWERED_HOLD_MS);
	}

	onMount(() => {
		store.start();
		void checkPush().then((s) => (pushState = s));
		return () => store.stop();
	});

	// The same breakpoint the conversation switches on, from the same module.
	$effect(() => watchWide());

	// A drawer left open across a resize would sit under the sidebar showing
	// the very same tree.
	$effect(() => {
		if (screen.wide) treeOpen = false;
	});

	const blocked = $derived(store.agents.filter((a) => a.status === 'blocked').length);
	const working = $derived(store.agents.filter((a) => a.status === 'working').length);
	const split = $derived(
		partitionAgents(store.agents, prefs.value.groupBy, prefs.value.sort, prefs.value.listFilter)
	);
	/** How many rows the lit badge is hiding, for the strip's clear line. */
	const hidden = $derived(
		store.agents.length -
			(split.blocked.length + split.groups.reduce((n, g) => n + g.agents.length, 0))
	);
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
		// A second tap while the first is in flight sends a SECOND keystroke to a
		// terminal, not merely a repeat request. `disabled` lands a tick later
		// than a fast double-tap does, so the guard has to be here too.
		if (answering === agent.paneId) return;
		answering = agent.paneId;
		answeringIndex = index;
		try {
			const response = await track(() =>
				fetch(`/api/agents/${encodeURIComponent(agent.paneId)}/answer`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ index })
				})
			);
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
			} else if (holdsAnswer(agent.picker)) {
				// The server checked the screen and the menu moved. Retire the
				// buttons now instead of letting them come back unanswered. A
				// checkbox picker never reaches here: its "accepted" means one box
				// flipped, and the buttons must stay for the next tick.
				answered = {
					...answered,
					[agent.paneId]: {
						key: pickerKey(agent.picker),
						at: Date.now(),
						// What was chosen, not merely that something was: "sent" alone
						// leaves you wondering which button you actually hit.
						label: agent.picker?.options?.find((o) => o.index === index)?.label ?? `option ${index}`
					}
				};
				clock = Date.now();
			}
		} catch {
			flagAnswer(agent.paneId, 'Nothing was sent — check the connection and try again.');
		}
		answering = '';
		answeringIndex = -1;
	}

	const GROUP_CHIPS: Array<{ v: GroupBy; l: string }> = [
		{ v: 'workspace', l: 'Workspace' },
		{ v: 'status', l: 'Status' },
		{ v: 'harness', l: 'Harness' },
		{ v: 'none', l: 'None' }
	];
</script>

<!--
	Desktop puts the workspace tree beside the list instead of behind a drawer,
	the same shape the conversation has had. One component and one breakpoint,
	so the two pages cannot drift; below `lg` this is exactly the phone layout
	it was.
-->
<div class="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
	<!--
		Only when the badge strip is off. With the strip on, this said "1
		working" directly above a cell reading "1 working" — the same fact
		twice, and the header's copy was the one you could not tap.
	-->
	{#snippet listStatus()}
		{#if !prefs.value.rollup}
			{#if blocked > 0}
				<span class="rounded-md bg-blocked-bg px-2 py-[3px] text-xs font-medium text-blocked-ink">
					{blocked} blocked
				</span>
			{:else if working > 0}
				<span class="rounded-md bg-working-bg px-2 py-[3px] text-xs font-medium text-working">
					{working} working
				</span>
			{/if}
		{/if}
	{/snippet}

	{#snippet listActions()}
		{#if screen.wide}
			<button
				class="flex h-9 items-center gap-1.5 rounded-full bg-ink px-3 text-[13px] font-medium text-card"
				onclick={() => (showNew = true)}
			>
				<Icon name="plus" size={16} /> New
			</button>
		{/if}
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
			<!--
				On is a filled pill, not just a greener bell. Colour alone was the
				whole signal for "notifications are on", which is the one control
				here you cannot verify by tapping it to see what happens.
			-->
			<button
				class="flex h-9 w-9 items-center justify-center rounded-full {pushState === 'on'
					? 'bg-done-bg text-done'
					: 'text-faint active:bg-chip'}"
				aria-label={pushState === 'on' ? 'Disable notifications' : 'Enable notifications'}
				aria-pressed={pushState === 'on'}
				onclick={onTogglePush}
			>
				<Icon name="bell" size={18} />
			</button>
		{/if}
	{/snippet}

	<header class="shrink-0 border-b border-hairline">
		<AppHeader
			onmenu={() =>
				screen.wide ? prefs.set('sidebarOpen', !prefs.value.sidebarOpen) : (treeOpen = !treeOpen)}
			menuLabel="Workspaces"
			menuExpanded={screen.wide ? prefs.value.sidebarOpen : treeOpen}
			middle={listStatus}
			actions={listActions}
		/>
	</header>

	<div class="flex w-full min-w-0 flex-1 lg:min-h-0">
		<!--
			Mounted only at desktop widths, not merely hidden: a `hidden lg:block`
			aside still exists on a phone, which would mean two trees polling
			/api/panes and a stray copy of the drawer's markup in the DOM.
		-->
		{#if screen.wide && prefs.value.sidebarOpen}
			<aside
				class="relative hidden shrink-0 overflow-y-auto border-r border-hairline lg:block"
				style="width: {prefs.value.sidebarWidth}px"
			>
				<SessionTree onnew={() => (showNew = true)} />
				<SidebarResizer onreset={() => prefs.set('sidebarWidth', DEFAULT_SIDEBAR)} />
			</aside>
		{/if}

		<!--
			The column everything else lives in. It scrolls on its own at desktop
			widths so the header and the tree stay put, and is the plain page flow
			on a phone.
		-->
		<div class="flex min-w-0 flex-1 flex-col lg:min-h-0 lg:overflow-y-auto">
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

			<InstallPrompt />

			<!--
		Capped and centred rather than run to the window edge. The rows are
		one-line cards: past about 1100px a card puts its title hard left and its
		status hard right with a gulf between them, which is harder to read
		across, not easier.
	-->
			<main class="mx-auto w-full max-w-5xl flex-1 px-4 pt-3 pb-32 lg:pb-6">
				{#if sharedCount > 0}
					<!--
				Was nested INSIDE the rollup grid, so it sat in a 4-column cell and
				the share notice came out a quarter of the width. It is not a
				rollup cell; it goes above the strip.
			-->
					<div class="mb-3 rounded-xl border border-working bg-working-bg px-3 py-2 text-[13px]">
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

				{#if prefs.value.rollup && store.agents.length > 0}
					<div
						class="mb-3 grid grid-cols-5 gap-px overflow-hidden rounded-xl border border-hairline bg-black/[.07] dark:bg-white/[.07]"
						role="group"
						aria-label="Filter the list"
					>
						{#each rollup as cell (cell.status)}
							{@const on = prefs.value.listFilter === cell.status}
							<!--
						A cell with nothing in it is not a filter, it is a dead end —
						tapping it would empty the list to prove a zero you can already
						read. Disabled rather than hidden: the strip must not reflow
						its columns every time a pane changes state.
					-->
							<!--
						The padding and the label shrink below 360px. At 320 a fifth of
						the row is 57px, and `unpushed` came out as `unpus…` — a label
						you cannot read is not a label, and this is the one cell whose
						meaning is not also written in the list below it.
					-->
							<button
								class="px-2 pt-2.5 pb-2 text-left transition-colors disabled:opacity-45 max-[360px]:px-1 {on
									? 'bg-ink'
									: cell.status === 'blocked' && cell.n > 0
										? 'bg-blocked-bg'
										: 'bg-card'}"
								disabled={cell.n === 0 && !on}
								aria-pressed={on}
								aria-label="{cell.n} {cell.label}{on ? ', showing only these' : ''}"
								onclick={() => prefs.set('listFilter', on ? null : cell.status)}
							>
								<span
									class="block font-mono text-[21px] leading-none {on
										? 'text-card'
										: cell.status === 'blocked'
											? 'text-blocked-ink'
											: cell.status === 'dirty'
												? 'text-branch'
												: (STATUS_INK[cell.status as AgentStatus] ?? '')}"
								>
									{cell.n}
								</span>
								<span
									class="mt-1.5 block truncate text-[10.5px] max-[360px]:text-[9.5px] {on
										? 'text-card'
										: cell.status === 'blocked'
											? 'text-blocked-ink'
											: 'text-muted'}"
								>
									{cell.label}
								</span>
							</button>
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

				{#if prefs.value.listFilter && hidden > 0}
					<!--
				A lit badge is a filter that outlives the tab, so the list has to
				say out loud that it is not showing everything — otherwise a quiet
				morning and a filter left on from yesterday look identical.
			-->
					<div class="mb-3 flex items-center gap-2 text-[12px] text-muted">
						<span class="min-w-0 flex-1 truncate"
							>Filtered to {prefs.value.listFilter === 'dirty'
								? 'unpushed'
								: prefs.value.listFilter} ·
							{hidden} hidden</span
						>
						<button
							class="shrink-0 rounded-full bg-chip px-3 py-1.5 text-[12px] text-ink"
							onclick={() => prefs.set('listFilter', null)}>Show all</button
						>
					</div>
				{/if}

				{#if split.blocked.length > 0}
					<div class="mb-1.5 flex items-center gap-2">
						<h2 class="font-mono text-[11px] text-blocked-ink">needs you</h2>
						<span class="h-px flex-1 bg-blocked-edge"></span>
					</div>
					<ul class="mb-4 grid grid-cols-1 gap-1.5 lg:grid-cols-2">
						{#each split.blocked as agent (agent.paneId)}
							<li
								class="min-w-0 overflow-hidden rounded-xl border border-blocked-edge bg-blocked-surface"
							>
								<div class="flex">
									<span class="w-1 shrink-0 self-stretch bg-blocked"></span>
									<div class="min-w-0 flex-1 px-3 py-[11px]">
										<a href={resolve('/a/[pane]', { pane: agent.paneId })} class="block min-w-0">
											<span class="flex items-baseline gap-2">
												<span class="min-w-0 flex-1 truncate text-[15px] font-medium">
													{agent.title || agent.paneId}
												</span>
												<span class="shrink-0 font-mono text-[10.5px] text-blocked-ink"
													>blocked</span
												>
											</span>
											<span class="mt-[3px] block truncate font-mono text-[11px] text-muted">
												<span class={harnessText(agent.agent)}>{agent.agent}</span> · {collapseHome(
													agent.cwd
												)}
											</span>
											{#if prefs.value.showTabName && agent.tabLabel}
												<!-- Which pane is asking. Most worth saying here, where
												     you are about to answer one of several. -->
												<span class="block truncate font-mono text-[11px] text-faint">
													&#x2299; {agent.tabLabel}
												</span>
											{/if}
										</a>

										{#if settled(agent)}
											<!--
												Answered, and the list has not caught up yet. Its own
												line: falling through to "waiting on you" would say the
												opposite of what just happened, and leaving the buttons
												pulsing says the answer never went.
											-->
											<p class="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-muted">
												<span class="min-w-0 truncate"
													>sent “{answered[agent.paneId]?.label ?? ''}”</span
												>
												<Ticks state="sent" />
											</p>
										{:else if agent.picker?.options?.length}
											{#if agent.picker.question}
												<p class="mt-2 text-[13.5px]">{agent.picker.question}</p>
											{/if}
											<div class="mt-2 flex flex-wrap gap-1.5">
												{#each agent.picker.options.slice(0, 3) as option, i (option.index)}
													{@const sending =
														answering === agent.paneId && answeringIndex === option.index}
													{@const multi = agent.picker.multi === true}
													<!--
														On a checkbox picker a tap toggles one box, so the lit
														buttons are the ticked ones rather than the first: the
														buttons stay after a toggle, and they have to say which
														boxes are ticked or the next tap is a guess.
													-->
													<button
														class="flex items-center gap-2 rounded-[7px] px-3.5 py-2 text-[12.5px] transition-opacity {(
															multi ? option.checked === true : i === 0
														)
															? 'bg-ink text-card'
															: 'bg-chip text-ink'} {answering === agent.paneId && !sending
															? 'opacity-40'
															: ''} {sending ? 'animate-pulse' : ''}"
														aria-pressed={multi ? option.checked === true : undefined}
														disabled={answering === agent.paneId}
														onclick={() =>
															// A write-in row needs text, and the composer is on the
															// conversation: answering it from here confirmed it empty.
															option.writeIn
																? goto(resolve('/a/[pane]', { pane: agent.paneId }))
																: answer(agent, option.index)}
													>
														{#if sending}<Spinner size={13} label="Sending your answer" />{/if}
														{#if multi && option.checked}✓{/if}
														{option.index}. {option.label}{#if option.writeIn}<span
																aria-hidden="true"
															>
																✎</span
															>{/if}
													</button>
												{/each}
												<!--
													A checkbox picker is submitted from the conversation, which
													has the Submit control; the list only toggles boxes, so it
													always offers the way there.
												-->
												{#if agent.picker.options.length > 3 || agent.picker.multi}
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
					<ul class="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
						{#each group.agents as agent (agent.paneId)}
							<li class="min-w-0">
								<AgentRow {agent} unread={unread(agent)} preview={previewOf(agent)} {query} />
							</li>
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
		</div>
	</div>

	<!--
		Pinned to the right of the CONTENT column, not of the window. `fixed
		right-4` put it at the edge of the screen, which on a desktop is most of
		a monitor away from the list it acts on. The rail is the same width as
		the page wrapper and ignores taps, so nothing changes on a phone.

		Phone only. Once a 276px aside is beside the column, a rail measured off
		the window centre no longer lines up with anything; desktop puts the
		same action in the header, where a mouse already is.
	-->
	<div
		class="pointer-events-none fixed inset-x-0 z-30 mx-auto flex max-w-screen-sm justify-end px-4 lg:hidden"
		style="bottom: calc(env(safe-area-inset-bottom) + 4.5rem)"
	>
		<button
			class="pointer-events-auto flex h-[52px] w-[52px] items-center justify-center rounded-full bg-ink text-card shadow-[0_8px_20px_rgba(0,0,0,.2)]"
			aria-label="New agent"
			onclick={() => (showNew = true)}
		>
			<Icon name="plus" size={24} />
		</button>
	</div>

	{#if treeOpen}
		<div class="fixed inset-0 z-40">
			<!--
				Presentational: the drawer's own ☰ is the labelled control, so
				announcing this as a second way to close it would put two buttons
				with the same job in the accessibility tree.
			-->
			<button
				class="no-press absolute inset-0 bg-black/40"
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
