<script lang="ts">
	import './layout.css';
	import { navigating, page, updated } from '$app/state';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { browser } from '$app/env';
	import { homeBelowAfter, replacesHistory, stepsBackHome } from '#lib/back.js';
	import { onMount } from 'svelte';
	import { installCapture } from '#lib/install-event.svelte.js';
	import { prefs } from '#lib/prefs.svelte.js';
	import { reportStandalone } from '#lib/push-client.js';
	import { agentStore } from '#lib/agents.svelte.js';
	import { armChimes, chime } from '#lib/chime.js';
	import { alertsFor, snapshot } from '#lib/alerts.js';
	import { netBusy } from '#lib/pending.svelte.js';
	import { mayReload, reloadHolds, typingUnsaved } from '#lib/reload-guard.svelte.js';
	import type { AgentStatus } from '#lib/types.js';
	let { children } = $props();

	/**
	 * Which routes may use a desktop window, rather than staying in the phone
	 * column the rest of the app lives in.
	 *
	 * The two that put the session tree beside their content: the conversation
	 * and the agents list. A route earns the window by having something to do
	 * with it. The cap came back in the first place because the list used to
	 * stretch the whole screen as ONE column — a card with its title hard left
	 * and its status hard right a thousand pixels apart, and five rollup
	 * badges each 250px wide holding one digit. It now caps its own column and
	 * runs two of them, so the width buys rows instead of gaps. Settings earns
	 * it the same way, with its section nav, and the connection page carries
	 * that same nav so moving to it does not reflow the app. Search and the
	 * files browser have nothing to put there and stay in the column.
	 */
	const WIDE_ROUTES = ['/', '/a/[pane]', '/settings', '/settings/connection'];
	const wide = $derived(WIDE_ROUTES.includes(page.route.id ?? ''));

	/**
	 * Catch the install offer as early as app code runs, on every route.
	 *
	 * At the top of the script rather than in `onMount`: `beforeinstallprompt`
	 * fires once per page load and can arrive while the tree is still
	 * hydrating. The layout never unmounts, so there is no teardown to run.
	 */
	if (browser) installCapture.listen(window);

	/**
	 * One back to the agents list, from any screen, when Settings says Home.
	 *
	 * The root below replaces history for every link off `/`; this keeps a link
	 * back to `/` from stacking a second copy of the list on the one already
	 * underneath. Tracked here because only the layout sees every navigation.
	 */
	let homeBelow = false;
	// SvelteKit 3 reports shallow URL updates (replaceState) here too; they
	// move nothing in history this tracks, so they must not count.
	beforeNavigate((nav) => {
		if (nav.shallow || !nav.to || !nav.from) return;
		const move = {
			type: nav.type,
			from: nav.from.url.pathname,
			to: nav.to.url.pathname,
			search: nav.to.url.search
		};
		if (!stepsBackHome(prefs.value.backTo, homeBelow, move)) return;
		nav.cancel();
		// After this navigation has finished cancelling, not inside it.
		queueMicrotask(() => history.back());
	});
	afterNavigate((nav) => {
		if (nav.shallow) return;
		homeBelow = homeBelowAfter(
			homeBelow,
			{
				type: nav.type,
				from: nav.from?.url.pathname ?? null,
				to: nav.to?.url.pathname ?? page.url.pathname
			},
			prefs.value.backTo
		);
	});

	/**
	 * A phone brought back to the app is the moment a new build is most
	 * likely to have landed; ask straight away rather than waiting for the
	 * next poll.
	 */
	/**
	 * Did the stylesheet actually arrive?
	 *
	 * A tab left open for days keeps pointing at the hashed CSS of the build
	 * it loaded with. Delete that build and the page has no stylesheet at all
	 * — every layout rule gone, the sidebar stacked on top of the
	 * conversation — and nothing on the page says so. It happened on a desktop
	 * tab while the phone, which had reloaded at some point, was fine.
	 *
	 * `--page` is defined on `:root` in layout.css and nowhere else, so an
	 * empty value means the sheet is missing rather than merely late: this
	 * runs on mount, by which point a `<link>` in the head has either applied
	 * or failed.
	 *
	 * Reloading fetches the HTML fresh — it is `no-cache` — and with it the
	 * current asset names. Once per tab, because a reload that finds the same
	 * emptiness must not become a loop: if the second look still has no
	 * stylesheet the cause is something a reload cannot fix, and a broken page
	 * beats a page that reloads for ever.
	 */
	onMount(() => {
		const painted = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
		if (painted) return;
		let tried = false;
		try {
			tried = sessionStorage.getItem('bordr-css-reload') === '1';
			sessionStorage.setItem('bordr-css-reload', '1');
		} catch {
			// Private windows throw on storage; one reload is still better than none.
		}
		if (!tried) location.reload();
	});

	onMount(() => {
		const onVisible = () => {
			if (document.visibilityState === 'visible') void updated.check();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

	/**
	 * Tell the service worker, once, that this origin runs as an installed app.
	 * It cannot find that out for itself, and it decides between launching the
	 * app and reusing an open browser tab when a notification is tapped.
	 */
	onMount(() => void reportStandalone());

	/**
	 * Paint the theme on <html>, not on a wrapper: the browser paints its own
	 * background behind the app, so a themed wrapper alone leaves the overscroll
	 * area and the address bar showing the wrong colour.
	 */
	$effect(() => {
		const dark = prefs.resolvedTheme === 'dark';
		// Both classes are stamped: `.light` is what tells the pre-hydration
		// media-query fallback to stand down on a system-dark device.
		document.documentElement.classList.toggle('dark', dark);
		document.documentElement.classList.toggle('light', !dark);
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', dark ? '#0a0a0a' : '#f4f5f7');
	});

	$effect(() => prefs.watchSystemTheme());

	/**
	 * The new build announcing itself, rather than the 30-second poll noticing.
	 *
	 * The worker activates the moment a deploy lands, so the banner can be up
	 * immediately instead of up to half a minute later — which is the window
	 * in which a page keeps asking for assets the new build may not have.
	 */
	let workerSaysStale = $state(false);
	$effect(() => {
		if (!navigator.serviceWorker) return;
		const heard = (event: MessageEvent) => {
			if ((event.data as { type?: string })?.type === 'bordr:updated') workerSaysStale = true;
		};
		navigator.serviceWorker.addEventListener('message', heard);
		return () => navigator.serviceWorker.removeEventListener('message', heard);
	});

	/**
	 * Load the new build without the tap, when nothing would be lost.
	 *
	 * The rules are in src/lib/reload-guard.svelte.ts. This only watches the
	 * moment: when you last touched the page, whether it is showing, and
	 * whether a page or a request has asked to hold. A page that comes back
	 * stale straight after reloading itself keeps the banner instead — a
	 * reload that cannot fix the staleness must not become a loop.
	 */
	const AUTO_RELOAD_KEY = 'bordr-auto-reload';
	const AUTO_RELOAD_COOLDOWN_MS = 5 * 60_000;
	const stale = $derived(updated.current || workerSaysStale);
	let lastTouched = Date.now();
	$effect(() => {
		const touched = () => (lastTouched = Date.now());
		const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
		for (const name of events) addEventListener(name, touched, { passive: true, capture: true });
		return () => {
			for (const name of events) removeEventListener(name, touched, { capture: true });
		};
	});
	$effect(() => {
		if (!stale) return;
		const consider = () => {
			const moment = {
				stale: true,
				held: reloadHolds.any,
				busy: netBusy.active,
				typing: typingUnsaved(document.activeElement),
				hidden: document.visibilityState === 'hidden',
				idleMs: Date.now() - lastTouched
			};
			if (!mayReload(moment)) return;
			try {
				const last = Number(sessionStorage.getItem(AUTO_RELOAD_KEY) ?? 0);
				if (Date.now() - last < AUTO_RELOAD_COOLDOWN_MS) return;
				sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
			} catch {
				// Without storage there is no loop guard, so leave it to the banner.
				return;
			}
			location.reload();
		};
		consider();
		const timer = setInterval(consider, 5_000);
		document.addEventListener('visibilitychange', consider);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', consider);
		};
	});

	/**
	 * A noise when an agent starts needing you, or finishes.
	 *
	 * In the layout because it should sound wherever you are in the app — the
	 * agent that goes blocked is usually not the one you are looking at, which
	 * is the entire reason for wanting it.
	 *
	 * Push notifications cover the app being closed; this covers it being open,
	 * where a notification is either suppressed by the OS or redundant.
	 */
	$effect(() => armChimes());

	/**
	 * How many agents are waiting, on the app's own icon.
	 *
	 * The thing a notification cannot do is still be there tomorrow. A badge
	 * is the standing count — you see there are two waiting without opening
	 * anything, and it clears itself when they are dealt with.
	 *
	 * Only where the browser has it: Safari and Firefox do not, and a missing
	 * badge must not be an error in the console on every status change.
	 */
	$effect(() => {
		// Turned off: clear whatever is already on the icon rather than freezing
		// yesterday's count there for ever.
		const waiting = prefs.value.appBadge
			? agentStore.agents.filter((a) => a.status === 'blocked').length
			: 0;
		const nav = navigator as Navigator & {
			setAppBadge?: (n?: number) => Promise<void>;
			clearAppBadge?: () => Promise<void>;
		};
		if (!nav.setAppBadge) return;
		// Held before it is awaited: `nav.clearAppBadge?.()` is `undefined` where
		// only half the API exists, and `.catch()` straight off that throws.
		const update = waiting > 0 ? nav.setAppBadge(waiting) : nav.clearAppBadge?.();
		void update?.catch(() => {});
	});

	let heard = new Map<string, AgentStatus>();
	$effect(() => {
		const agents = agentStore.agents;
		const sounds = alertsFor(heard, agents, prefs.value.soundAlerts);
		heard = snapshot(agents);
		// Only one, however many changed at once: four agents finishing together
		// should sound like an event, not like a fruit machine.
		if (sounds.length > 0) chime(sounds.includes('attention') ? 'attention' : 'done');
	});

	/**
	 * A bar across the top for as long as a navigation is in flight.
	 *
	 * On a fast link every navigation resolves before anyone could notice, so
	 * this waits 120ms before showing — a flash on every tap is worse than no
	 * feedback at all. On a slow one it appears almost at once, which is the
	 * whole point: the app answers the tap in a frame rather than sitting
	 * dead until the payload lands.
	 *
	 * It covers requests as well as navigations, so a control nobody thought
	 * to decorate still says that something is happening.
	 *
	 * In the layout, so every link and every `goto` in the app gets it without
	 * having to remember to.
	 */
	let showProgress = $state(false);
	$effect(() => {
		// A navigation OR a request in flight. Tapping an answer is not a
		// navigation, so the bar used to say nothing at all for the one kind of
		// wait where the app looks broken — the tap is over, the screen has not
		// changed, and the obvious move is to tap again.
		if (!navigating.to && !netBusy.active) {
			showProgress = false;
			return;
		}
		const timer = setTimeout(() => (showProgress = true), 120);
		return () => clearTimeout(timer);
	});
</script>

<!--
	Above everything, including the sticky header, and never intercepting a
	tap: it is a readout, not a control.
-->
{#if showProgress}
	<div
		class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-transparent"
		role="progressbar"
		aria-label="Loading"
	>
		<div class="h-full w-2/5 animate-[bordr-slide_1.1s_ease-in-out_infinite] bg-working"></div>
	</div>
{/if}

<!--
	The replace-history root for the whole app. SvelteKit reads the nearest
	`data-sveltekit-replacestate` above a link at the moment it is clicked, so
	this covers Files, Settings and Search the way the conversation page's own
	root already covered panes. On `/` it is off: leaving the list must push
	the one entry back returns to.
-->
<div
	class="mx-auto min-h-dvh max-w-screen-sm bg-page text-ink {wide ? 'lg:max-w-none' : ''}"
	data-sveltekit-replacestate={replacesHistory(prefs.value.backTo, page.url.pathname)
		? ''
		: 'false'}
>
	{#if stale}
		<!--
			The fallback for a page that cannot reload itself yet: a dictation, an
			unsent photo, a request in flight, a field being typed into, or history
			being read. Otherwise the effect above reloads it unprompted. SvelteKit
			already makes the next navigation a full load.
		-->
		<!--
			Along the bottom, not the top. At the top it sat straight over the
			header — the title, the mark and the menu underneath it — on every
			screen and every width, and it stays until you tap it, so the app's
			own navigation was covered up for as long as you ignored it.

			Measured rather than guessed: the tab bar stands 63px off the bottom
			and a composer with its status block stands 122px, so 8.5rem clears
			the taller of the two with room to spare, and the safe-area inset
			keeps it off the home indicator below them.
		-->
		<button
			class="fixed bottom-[calc(8.5rem+env(safe-area-inset-bottom))] left-1/2 z-30 min-h-11 -translate-x-1/2 rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-medium text-card shadow-[0_6px_18px_rgba(0,0,0,.18)]"
			onclick={() => location.reload()}
		>
			bordr has updated · tap to reload
		</button>
	{/if}
	{@render children()}
</div>
