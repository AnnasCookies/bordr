<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import TabBar from '$lib/components/tab-bar.svelte';

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
</script>

<svelte:head><title>{status} · bordr</title></svelte:head>

<div class="flex min-h-dvh flex-col">
	<main class="flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-24 text-center">
		<p class="font-mono text-[11px] text-muted">{status}</p>
		<p class="text-[15px] font-semibold">{status === 404 ? 'Not here' : 'Something went wrong'}</p>
		<p class="max-w-prose text-[13px] text-muted">{explanation}</p>
		<a
			href={resolve('/')}
			class="mt-3 inline-flex min-h-11 items-center rounded-full border border-edge px-4 text-[13px] font-medium text-working"
		>
			Back to agents
		</a>
	</main>

	<TabBar />
</div>
