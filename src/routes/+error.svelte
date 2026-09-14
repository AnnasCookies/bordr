<script lang="ts" module>
	import { FIRST_WAIT_MS, MAX_WAIT_MS, recoverable, waitFor } from '$lib/recover';

	/*
	 * The recovery loop's decisions, kept out of the component so they can be
	 * tested without a browser. The component only wires them to timers,
	 * sessionStorage and `fetch`.
	 */

	/** Where a path's failed-attempt count survives a reload. */
	export function attemptsKey(path: string): string {
		return `bordr-recover:${path}`;
	}

	/**
	 * Past this the wait has long since reached its cap, so a larger count buys
	 * nothing — and a stored number must not be able to grow without bound.
	 */
	export const MAX_ATTEMPT = 16;

	/**
	 * How long a stored count is believed.
	 *
	 * A loop that is still running writes at least once per MAX_WAIT_MS, so a
	 * record older than a few of those belongs to a failure that has since
	 * cleared; a new failure should start with the short wait again.
	 */
	export const FORGET_AFTER_MS = 4 * MAX_WAIT_MS;

	/** A probe that has not answered by now is treated as a failure. */
	export const PROBE_TIMEOUT_MS = 15_000;

	export function writeAttempt(attempt: number, now: number): string {
		return JSON.stringify({ attempt: Math.min(Math.max(0, attempt), MAX_ATTEMPT), at: now });
	}

	/** The stored count for a path, or 0 for nothing, nonsense or a stale record. */
	export function readAttempt(raw: string | null, now: number): number {
		if (!raw) return 0;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			// Corrupt storage is not a reason to stop recovering: start again.
			return 0;
		}
		if (typeof parsed !== 'object' || parsed === null) return 0;
		const { attempt, at } = parsed as { attempt?: unknown; at?: unknown };
		if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 0) return 0;
		if (typeof at !== 'number' || !Number.isFinite(at)) return 0;
		if (at > now || now - at > FORGET_AFTER_MS) return 0;
		return Math.min(attempt, MAX_ATTEMPT);
	}

	/**
	 * Should the page reload, given what re-requesting it answered?
	 *
	 * `status` is the page's own status, 0 when the request never landed. Only
	 * an answer that is no longer a recoverable failure earns a reload: a
	 * reload into the same 503 is just the error page again, a full server
	 * render and a herdr call later. A 404 does reload, because that is a real
	 * answer the error page should show rather than keep retrying.
	 */
	export function shouldReload(status: number): boolean {
		return status > 0 && !recoverable(status);
	}

	/**
	 * What to do after one probe.
	 *
	 * The count goes up whether or not the page reloads: if the reload lands on
	 * the same failure after all, the next mount has to carry on backing off
	 * from here rather than starting at two seconds again.
	 */
	export function afterProbe(
		status: number,
		attempt: number
	): { reload: boolean; attempt: number; wait: number } {
		const next = Math.min(Math.max(0, attempt) + 1, MAX_ATTEMPT);
		return { reload: shouldReload(status), attempt: next, wait: waitFor(next) };
	}

	/**
	 * May a wake-up (`online`, the page becoming visible) probe right now?
	 *
	 * A wake skips the countdown because a phone out of a tunnel should not sit
	 * on a timer, but it must not become a way round the backoff: flicking
	 * between apps would otherwise probe on every flick.
	 */
	export function wakeDue(lastProbeAt: number, now: number): boolean {
		return now - lastProbeAt >= FIRST_WAIT_MS;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import TabBar from '$lib/components/tab-bar.svelte';
	import Spinner from '$lib/components/spinner.svelte';

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
	 * The probe is the page itself, not `/_app/version.json`. A static file
	 * answering proves bordr is up, not that this page's load now works: with
	 * herdr stopped, a pane's load keeps answering 503 while version.json
	 * answers 200, and the page reloaded into the same 503 every two seconds
	 * for ever. `no-store` because a cached answer would describe the past.
	 *
	 * The attempt count lives in sessionStorage, keyed by path, because a
	 * reload resets component state — a count held only here restarted at zero
	 * on every round, so the backoff never grew.
	 */
	const retrying = $derived(recoverable(status));
	let attempt = 0;
	let lastProbeAt = 0;
	let next = $state(0);
	let checking = $state(false);
	let now = $state(Date.now());

	const seconds = $derived(Math.max(0, Math.ceil((next - now) / 1000)));

	function loadAttempt(): number {
		try {
			return readAttempt(sessionStorage.getItem(attemptsKey(path)), Date.now());
		} catch (err) {
			// Storage blocked (a private window): the count lasts as long as this
			// page, which still backs off and is still capped.
			console.warn('bordr: could not read the retry count', err);
			return attempt;
		}
	}

	function saveAttempt(value: number): void {
		attempt = value;
		try {
			sessionStorage.setItem(attemptsKey(path), writeAttempt(value, Date.now()));
		} catch (err) {
			console.warn('bordr: could not keep the retry count across a reload', err);
		}
	}

	async function check(): Promise<void> {
		if (checking) return;
		checking = true;
		lastProbeAt = Date.now();
		let probed = 0;
		try {
			const response = await fetch(location.href, {
				cache: 'no-store',
				headers: { accept: 'text/html' },
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
			});
			probed = response.status;
			// Only the status is wanted; a rendered page is not worth downloading
			// just to throw away. A body that will not cancel costs nothing more.
			response.body?.cancel().catch((err: unknown) => {
				console.warn('bordr: could not discard the probe body', err);
			});
		} catch {
			// Unreachable or timed out, which is the expected answer most times
			// round; `probed` stays 0 and the verdict below says wait.
		}
		const verdict = afterProbe(probed, attempt);
		saveAttempt(verdict.attempt);
		if (verdict.reload) {
			// A reload rather than a client-side navigation: this page exists
			// because a load failed, and the assets behind it may have changed
			// under us while the server was away.
			location.reload();
			return;
		}
		checking = false;
		next = Date.now() + verdict.wait;
	}

	onMount(() => {
		if (!retrying) return;
		attempt = loadAttempt();
		next = Date.now() + waitFor(attempt);
		const tick = setInterval(() => {
			now = Date.now();
			if (now >= next) void check();
		}, 500);
		// A phone coming out of a tunnel fires these long before any timer is
		// due. `visibilitychange` also fires on the way OUT, which is no moment
		// to ask anything.
		const wake = () => {
			if (document.visibilityState !== 'visible') return;
			if (!wakeDue(lastProbeAt, Date.now())) return;
			void check();
		};
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
