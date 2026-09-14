<script lang="ts">
	import { onMount } from 'svelte';
	import { version } from '$app/environment';
	import SettingsNav from '$lib/components/settings-nav.svelte';
	import AppHeader from '$lib/components/app-header.svelte';
	import SessionTree from '$lib/components/session-tree.svelte';
	import { screen, watchWide } from '$lib/wide.svelte';
	import { agentStore } from '$lib/agents.svelte';
	import ConnectionBanner, { type Connection } from '$lib/components/connection-banner.svelte';
	import TabBar from '$lib/components/tab-bar.svelte';

	const store = agentStore;
	/** Ticks so the "last event" age counts up rather than freezing on load. */
	let now = $state(Date.now());

	onMount(() => {
		store.start();
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => {
			clearInterval(timer);
			store.stop();
		};
	});

	const DOT: Record<Connection, string> = {
		live: 'bg-done',
		reconnecting: 'bg-faint',
		silent: 'bg-blocked',
		stale: 'bg-blocked',
		bordr: 'bg-blocked',
		herdr: 'bg-blocked',
		incompatible: 'bg-danger'
	};

	const age = $derived(
		store.lastSeen ? `${Math.max(0, Math.round((now - store.lastSeen) / 1000))}s ago` : 'never'
	);
	const host = $derived(typeof location === 'undefined' ? '' : location.host);

	const TILES = $derived([
		{ label: 'herdr session', value: store.compat?.session ?? '—' },
		{
			label: 'protocol · compat',
			value: `${store.compat?.protocol ?? '—'} · ${store.compat?.level ?? '—'}`
		},
		{ label: 'bordr build', value: buildStamp(version) }
	]);

	/** SvelteKit's default version is the build's epoch millis; a clock time is what a person can compare against a deploy. */
	function buildStamp(raw: string): string {
		const millis = Number(raw);
		if (!Number.isFinite(millis) || millis < 1e12) return raw;
		return new Date(millis).toLocaleString(undefined, {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	/** Every banner state, so the copy can be checked without provoking a fault. */
	const SAMPLES: Connection[] = ['bordr', 'silent', 'herdr', 'stale', 'incompatible'];

	$effect(() => watchWide());

	let treeOpen = $state(false);
</script>

<div class="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
	<!--
		The same app bar as everywhere else.

		This page drew its OWN back arrow in the title row, from before the bar
		had one. Now the bar does, and the two sat side by side pointing at
		different places — the agents list and Settings — with the one that
		looks like the back button being the wrong one. One arrow, aimed here at
		the page this sits under.
	-->
	{#snippet title()}
		<h1 class="truncate text-[17px] font-semibold">Connection</h1>
	{/snippet}

	<header class="shrink-0 border-b border-hairline">
		<AppHeader
			onmenu={() => (treeOpen = true)}
			menuLabel="Workspaces"
			menuExpanded={treeOpen}
			middle={title}
			backTo="/settings"
			backLabel="Back to settings"
		/>
	</header>

	<div class="flex w-full min-w-0 flex-1 lg:min-h-0">
		{#if screen.wide}
			<SettingsNav active="connection" />
		{/if}
		<div class="flex min-w-0 flex-1 flex-col lg:min-h-0 lg:overflow-y-auto">
			<main
				class="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 pt-3 pb-24 lg:mx-0 lg:px-6 lg:pb-8"
			>
				<section class="overflow-hidden rounded-xl border border-hairline bg-card">
					<div class="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
						<span class="h-2.5 w-2.5 shrink-0 rounded-full {DOT[store.connection]}"></span>
						<span class="text-[17px] font-semibold">{store.connection}</span>
					</div>
					<dl class="divide-y divide-black/[.06] text-[13px] dark:divide-white/[.06]">
						<div class="flex gap-3 px-3.5 py-2.5">
							<dt class="w-28 shrink-0 text-muted">host</dt>
							<dd class="min-w-0 flex-1 truncate font-mono">{host}</dd>
						</div>
						<div class="flex gap-3 px-3.5 py-2.5">
							<dt class="w-28 shrink-0 text-muted">stream</dt>
							<dd class="min-w-0 flex-1 font-mono">SSE /api/events</dd>
						</div>
						<div class="flex gap-3 px-3.5 py-2.5">
							<dt class="w-28 shrink-0 text-muted">last event</dt>
							<dd class="min-w-0 flex-1 font-mono">{age}</dd>
						</div>
					</dl>
				</section>

				<section class="grid grid-cols-3 gap-2">
					{#each TILES as tile (tile.label)}
						<div class="rounded-xl border border-hairline bg-card px-3 py-2.5">
							<div class="truncate font-mono text-[13px]">{tile.value}</div>
							<div class="mt-1 text-[11px] text-muted">{tile.label}</div>
						</div>
					{/each}
				</section>

				{#if store.compat?.message}
					<section>
						<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">herdr says</h2>
						<p class="rounded-xl border border-hairline bg-card px-3.5 py-3 text-[13px] text-body">
							{store.compat.message}
						</p>
					</section>
				{/if}

				<section>
					<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">banner reference</h2>
					<div class="-mx-4">
						{#each SAMPLES as sample (sample)}
							<ConnectionBanner connection={sample} compat={null} />
						{/each}
					</div>
					<p class="px-1 text-[11.5px] text-faint">
						What each fault looks like on the agents list. Shown here so the copy can be read
						without provoking the fault.
					</p>
				</section>
			</main>
		</div>
	</div>

	{#if treeOpen}
		<div class="fixed inset-0 z-40">
			<button
				class="absolute inset-0 bg-black/40"
				aria-label="Close the workspaces list"
				onclick={() => (treeOpen = false)}
			></button>
			<div class="absolute inset-y-0 left-0 w-[86%] max-w-[320px] shadow-2xl">
				<SessionTree />
			</div>
		</div>
	{/if}

	<TabBar />
</div>
