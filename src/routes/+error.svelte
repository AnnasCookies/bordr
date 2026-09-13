<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import TabBar from '$lib/components/tab-bar.svelte';
	import Spinner from '$lib/components/spinner.svelte';
	import { recoverable, waitFor } from '$lib/recover';

	const status = $derived(page.status);
	const path = $derived(page.url.pathname);

	/**
	 * Name the fix where it is known. A stale notification deep link is the
	 * usual 404 on /a; a fresh install with no browsable roots is the usual
	 * one on /f. Anything else shows what the server actually said, because
	 * "500" alone on a home-screen app with no address bar is a dead end.
	 */
	const explanation = $derived.by(() => {
		if (status === 404 && path.startsWith('/a/')) {
			return 'That agent has finished or its pane closed.';
		}
		if (status === 404 && path.startsWith('/f')) {
			return 'That folder or file is not there. If this is a fresh install, set BORDR_FILE_ROOTS in .env (README, step 3).';
		}
		return page.error?.message ?? 'Something went wrong.';
	});

	/**
	 * Failures that fix themselves get watched for until they do.
	 *
	 * This page used to be terminal. Its only way out was "Back to agents",
	 * which fails exactly the same way while the server is still down — so a
	 * phone that lost the host during a deploy sat on a dead screen until
	 * somebody thought to pull down and refresh. A deploy takes seconds; the
	 * page should outlast it on its own.
	 *
	 * `/_app/version.json` is the probe: a real file this server serves, so a
	 * reply proves the app is back, and it costs a few dozen bytes. `no-store`
	 * because a cached 200 would say "back" for a host that is still down.
	 */
	const retrying = $derived(recoverable(status));
	let attempt = $state(0);
	let next = $state(0);
	let checking = $state(false);
	let now = $state(Date.now());

	const seconds = $derived(Math.max(0, Math.ceil((next - now) / 1000)));

	async function check(): Promise<void> {
		if (checking) return;
		checking = true;
		try {
			const response = await fetch(`/_app/version.json?probe=${Date.now()}`, { cache: 'no-store' });
			if (response.ok) {
				// Back. A reload rather than a client-side navigation: this page
				// exists because a load failed, and the assets behind it may have
				// changed under us while the server was away.
				location.reload();
				return;
			}
		} catch {
			// Still unreachable, which is the expected answer most times round.
		}
		checking = false;
		attempt += 1;
		next = Date.now() + waitFor(attempt);
	}

	onMount(() => {
		if (!retrying) return;
		next = Date.now() + waitFor(0);
		const tick = setInterval(() => {
			now = Date.now();
			if (now >= next) void check();
		}, 500);
		// A phone coming out of a tunnel fires this long before any timer is due.
		const wake = () => void check();
		addEventListener('online', wake);
		document.addEventListener('visibilitychange', wake);
		return () => {
			clearInterval(tick);
			removeEventListener('online', wake);
			document.removeEventListener('visibilitychange', wake);
		};
	});
</script>

<svelte:head><title>{status} · bordr</title></svelte:head>

<div class="flex min-h-dvh flex-col">
	<main class="flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-24 text-center">
		<p class="font-mono text-[11px] text-muted">{status}</p>
		<p class="text-[15px] font-semibold">{status === 404 ? 'Not here' : 'Something went wrong'}</p>
		<p class="max-w-prose text-[13px] text-muted">{explanation}</p>

		{#if retrying}
			<!--
				Says what it is doing and when, rather than spinning silently. The
				countdown is the difference between "this app is watching for the
				server" and "this app has hung".
			-->
			<p class="mt-2 flex items-center gap-2 text-[12.5px] text-muted" role="status">
				{#if checking}
					<Spinner size={13} label="Checking" />
					Looking for bordr…
				{:else}
					Trying again in {seconds}s
				{/if}
			</p>
			<button
				class="mt-1 min-h-11 rounded-full border border-edge px-4 text-[13px] font-medium text-working"
				onclick={() => void check()}
				disabled={checking}
			>
				Try now
			</button>
		{/if}

		<a
			href={resolve('/')}
			class="mt-3 inline-flex min-h-11 items-center rounded-full border border-edge px-4 text-[13px] font-medium {retrying
				? 'text-muted'
				: 'text-working'}"
		>
			Back to agents
		</a>
	</main>

	<TabBar />
</div>
