<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { version } from '$app/environment';
	import { agentStore } from '$lib/agents.svelte';
	import { netBusy } from '$lib/pending.svelte';
	import NetStatus, { netLabel, netState } from './net-status.svelte';

	/**
	 * "Can this app talk to anything right now", on every screen.
	 *
	 * It lived only in the conversation header, which is the one place you can
	 * already tell — the transcript stops moving. On the list, in settings, in
	 * the files browser, a dead stream looked exactly like a quiet fleet.
	 *
	 * Tapping opens the same numbers the Connection page carries, so a "why is
	 * nothing happening" is answered where the question is asked rather than
	 * three navigations away. The page itself is still there for the rest.
	 *
	 * The store is reference-counted, so holding it here is safe wherever this
	 * is mounted — including pages that never otherwise ask for agents.
	 */
	let open = $state(false);
	let now = $state(Date.now());

	onMount(() => {
		agentStore.start();
		// Only while the panel is open: a clock ticking behind a closed panel
		// is a re-render a second, for ever, to update nothing.
		return () => agentStore.stop();
	});

	$effect(() => {
		if (!open) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	let online = $state(true);
	$effect(() => {
		online = navigator.onLine;
		const sync = () => (online = navigator.onLine);
		addEventListener('online', sync);
		addEventListener('offline', sync);
		return () => {
			removeEventListener('online', sync);
			removeEventListener('offline', sync);
		};
	});

	const net = $derived(netState(online, agentStore.connection, netBusy.active));

	const age = $derived(
		agentStore.lastSeen
			? `${Math.max(0, Math.round((now - agentStore.lastSeen) / 1000))}s ago`
			: 'never'
	);

	/** The build's epoch millis are unreadable; a clock time compares against a deploy. */
	const build = $derived.by(() => {
		const millis = Number(version);
		if (!Number.isFinite(millis) || millis < 1e12) return version;
		return new Date(millis).toLocaleString(undefined, {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	});

	const rows = $derived([
		{ label: 'stream', value: agentStore.connection },
		{ label: 'last event', value: age },
		{ label: 'host', value: typeof location === 'undefined' ? '—' : location.host },
		{ label: 'herdr', value: agentStore.compat?.level ?? '—' },
		{ label: 'build', value: build }
	]);
</script>

<div class="relative shrink-0">
	<button
		class="flex h-9 w-7 items-center justify-center"
		aria-label="{netLabel(net)} — tap for details"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<NetStatus state={net} />
	</button>

	{#if open}
		<!-- Closes on a tap anywhere else, which is the only way out on a phone. -->
		<button
			class="fixed inset-0 z-40 cursor-default"
			aria-label="Close"
			onclick={() => (open = false)}
		></button>
		<div
			class="absolute top-full right-0 z-50 mt-1 w-[232px] overflow-hidden rounded-xl border border-hairline bg-card shadow-2xl"
			role="dialog"
			aria-label="Connection"
		>
			<p class="flex items-center gap-2 border-b border-hairline px-3 py-2 text-[13px] font-medium">
				<NetStatus state={net} />
				{netLabel(net)}
			</p>
			<dl class="divide-y divide-black/[.06] text-[12px] dark:divide-white/[.06]">
				{#each rows as row (row.label)}
					<div class="flex gap-2 px-3 py-1.5">
						<dt class="w-[74px] shrink-0 text-muted">{row.label}</dt>
						<dd class="min-w-0 flex-1 truncate font-mono">{row.value}</dd>
					</div>
				{/each}
			</dl>
			<a
				href={resolve('/settings/connection')}
				class="block border-t border-hairline px-3 py-2 text-[12.5px] text-working"
				onclick={() => (open = false)}>Connection details</a
			>
		</div>
	{/if}
</div>
