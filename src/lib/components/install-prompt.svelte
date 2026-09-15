<script lang="ts">
	import { onMount } from 'svelte';
	import { installOffer, isIOS, type InstallOffer } from '$lib/install';
	import { installCapture } from '$lib/install-event.svelte';

	/**
	 * An offer to install bordr, for the browser copy.
	 *
	 * bordr is built to be installed — the badge, the share target and the
	 * notification buttons only exist for a home-screen app — and nothing ever
	 * said so. You had to already know the browser menu had an item for it.
	 *
	 * Two mechanics, one banner. Chromium hands over a `beforeinstallprompt`
	 * event, which is stashed so bordr's own button can raise the real dialog
	 * at a moment of its choosing. Safari fires nothing and has no API at all,
	 * so the iOS half can only say where Add to Home Screen lives.
	 *
	 * The event is caught by the root layout, not here: it fires once per page
	 * load, often before this page exists — see `install-event.svelte.ts`.
	 *
	 * Dismissal is kept out of `prefs`: it is a fact about this browser, not a
	 * preference, and it has no business in the settings page or in an export.
	 */
	const DISMISSED_KEY = 'bordr-install-dismissed';

	const held = $derived(installCapture.held);
	let standalone = $state(true);
	let ios = $state(false);
	let dismissedAt = $state(0);
	let showIOSHelp = $state(false);
	let busy = $state(false);

	const offer = $derived<InstallOffer>(
		installOffer({
			standalone: standalone || installCapture.installed,
			hasPrompt: held !== null,
			ios,
			dismissedAt,
			now: Date.now()
		})
	);

	onMount(() => {
		// `display-mode: standalone` is the only signal on iOS, where no install
		// event ever arrives — without it an installed iPhone app would be told
		// to install itself.
		const installed = () =>
			matchMedia('(display-mode: standalone)').matches ||
			matchMedia('(display-mode: window-controls-overlay)').matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true;

		standalone = installed();
		ios = isIOS(navigator.userAgent, navigator.maxTouchPoints);
		try {
			dismissedAt = Number(localStorage.getItem(DISMISSED_KEY)) || 0;
		} catch {
			// A private window with storage blocked simply gets the offer.
		}
	});

	function remember() {
		dismissedAt = Date.now();
		try {
			localStorage.setItem(DISMISSED_KEY, String(dismissedAt));
		} catch {
			// Nothing to persist to; the banner returns next load, which is the
			// safe way round for a thing you can dismiss again in one tap.
		}
	}

	async function install() {
		const event = held;
		if (!event || busy) return;
		busy = true;
		try {
			await event.prompt();
			const { outcome } = await event.userChoice;
			// Spent either way: the event cannot be used twice. A refusal is a
			// dismissal — asking again on the next page load would be nagging.
			installCapture.spend();
			if (outcome === 'dismissed') remember();
		} catch (err) {
			// A prompt that throws has been used or revoked by the browser, so it
			// cannot be offered again; say why in the console rather than nowhere.
			console.warn('bordr: the install prompt could not be shown', err);
			installCapture.spend();
		}
		busy = false;
	}
</script>

{#if offer !== 'none'}
	<div
		class="mx-3 mt-2 flex items-center gap-3 rounded-xl border border-hairline bg-card px-3 py-2.5"
		role="region"
		aria-label="Install bordr"
	>
		<img src="/patrl-192.png" alt="" class="h-9 w-9 shrink-0 rounded-lg" />
		<div class="min-w-0 flex-1">
			<p class="text-[13.5px] font-medium">Install bordr</p>
			<p class="text-[12px] text-muted">
				{#if offer === 'ios'}
					Share, then Add to Home Screen.
				{:else}
					Full screen, and notifications when an agent needs you.
				{/if}
			</p>
		</div>
		{#if offer === 'prompt'}
			<button
				class="min-h-9 shrink-0 rounded-full bg-ink px-3.5 text-[12.5px] font-medium text-card disabled:opacity-50"
				onclick={install}
				disabled={busy}>Install</button
			>
		{:else}
			<button
				class="min-h-9 shrink-0 rounded-full bg-chip px-3.5 text-[12.5px] font-medium text-ink"
				onclick={() => (showIOSHelp = !showIOSHelp)}
				aria-expanded={showIOSHelp}>How</button
			>
		{/if}
		<button
			class="shrink-0 px-1 text-[18px] leading-none text-faint"
			onclick={remember}
			aria-label="Not now">&times;</button
		>
	</div>

	{#if offer === 'ios' && showIOSHelp}
		<!--
			Safari has no install API, so this is the whole of what bordr can do:
			name the two taps. Worth naming precisely — the share control is at
			the bottom of the screen on an iPhone and the top on an iPad.
		-->
		<ol
			class="mx-3 mt-1 list-decimal rounded-xl border border-hairline bg-card py-2 pr-3 pl-8 text-[12.5px] text-muted"
		>
			<li>Tap the Share button — the square with an arrow out of it.</li>
			<li>Scroll down and tap <span class="font-medium text-ink">Add to Home Screen</span>.</li>
			<li>Open bordr from the icon, not from Safari, or notifications will not arrive.</li>
		</ol>
	{/if}
{/if}
