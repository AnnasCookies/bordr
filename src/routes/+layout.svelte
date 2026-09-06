<script lang="ts">
	import './layout.css';
	import { updated } from '$app/state';
	import { onMount } from 'svelte';
	import { prefs } from '$lib/prefs.svelte';
	let { children } = $props();

	/**
	 * A phone brought back to the app is the moment a new build is most
	 * likely to have landed; ask straight away rather than waiting for the
	 * next poll.
	 */
	onMount(() => {
		const onVisible = () => {
			if (document.visibilityState === 'visible') void updated.check();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	});

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
</script>

<div class="mx-auto min-h-dvh max-w-screen-sm bg-page text-ink">
	{#if updated.current}
		<!--
			Never reloaded for the person: a draft or a dictation in flight would
			be lost. SvelteKit already makes the next navigation a full load;
			this is for the page that never navigates.
		-->
		<button
			class="fixed top-2 left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] font-medium text-card shadow-[0_6px_18px_rgba(0,0,0,.18)]"
			onclick={() => location.reload()}
		>
			bordr has updated · tap to reload
		</button>
	{/if}
	{@render children()}
</div>
