<script lang="ts">
	import { onMount } from 'svelte';
	import { version } from '$app/environment';
	import { resolve } from '$app/paths';
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
</script>

<div class="flex min-h-dvh flex-col">
	<header class="flex items-center gap-1 px-2 pt-2 pb-2">
		<a
			href={resolve('/settings')}
			class="flex h-10 w-10 shrink-0 items-center justify-center font-mono text-base text-working"
			aria-label="Back to settings">←</a
		>
		<h1 class="text-[17px] font-semibold">Connection</h1>
	</header>

	<main class="flex-1 space-y-5 px-4 pb-24">
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
				What each fault looks like on the agents list. Shown here so the copy can be read without
				provoking the fault.
			</p>
		</section>
	</main>

	<TabBar />
</div>
