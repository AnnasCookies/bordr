<script lang="ts">
	import { onMount } from 'svelte';
	import { ansiToHtml } from '$lib/ansi';
	import Icon from './icon.svelte';

	/**
	 * The pane as the terminal draws it, with a prompt line under it.
	 *
	 * Not a second conversation view: this is the screen itself, so a shell,
	 * a build, a picker and an agent mid-turn all look here exactly as they
	 * look on the machine. Typing goes to the pane through the same prompt
	 * channel the composer uses, and the navigation keys go through the same
	 * key channel the keypad uses — terminal mode changes what you SEE, not
	 * what bordr is allowed to send.
	 */
	let {
		paneId,
		draft = $bindable(''),
		lines = 200,
		mono = 12,
		dictating = false,
		onsend,
		onkeys,
		onmic,
		busy = false
	}: {
		paneId: string;
		/** Bound, so dictation writes into this line the way it does the composer. */
		draft?: string;
		lines?: number;
		mono?: number;
		dictating?: boolean;
		onsend: (text: string) => Promise<void> | void;
		onkeys: (keys: string[]) => Promise<void> | void;
		onmic?: () => void;
		busy?: boolean;
	} = $props();

	let text = $state('');
	let screen = $state<HTMLElement | undefined>();
	let input = $state<HTMLInputElement | undefined>();
	let stuck = $state(true);

	async function load(id: string) {
		try {
			const res = await fetch(
				`/api/agents/${encodeURIComponent(id)}/read?lines=${lines}&ansi=1&source=visible`
			);
			if (res.ok) text = (await res.json()).text ?? '';
		} catch {
			// A dropped poll leaves the last screen up rather than blanking it.
		}
	}

	$effect(() => {
		const id = paneId;
		text = '';
		void load(id);
		// A second is what the terminal itself feels like; the screen is small
		// and the read is one socket round trip.
		const timer = setInterval(() => void load(id), 1000);
		return () => clearInterval(timer);
	});

	// The screen follows its own bottom, the way a terminal does, unless you
	// have scrolled up to read something.
	$effect(() => {
		void text;
		if (stuck && screen) screen.scrollTop = screen.scrollHeight;
	});

	async function submit() {
		const line = draft;
		draft = '';
		// An empty line is Enter on its own, which is a real thing to send at a
		// prompt — a confirmation, a blank command, dismissing a picker.
		if (line.trim()) await onsend(line);
		else await onkeys(['enter']);
		input?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			void submit();
			return;
		}
		// Arrows and tab belong to the pane while the prompt line is empty —
		// history, completion and pickers all live there, not here.
		const passthrough: Record<string, string> = {
			ArrowUp: 'up',
			ArrowDown: 'down',
			Tab: 'tab',
			Escape: 'esc'
		};
		const key = passthrough[event.key];
		if (!key) return;
		if ((key === 'up' || key === 'down') && draft) return;
		event.preventDefault();
		void onkeys([key]);
	}

	/**
	 * Ctrl/Cmd+; toggles the microphone.
	 *
	 * Chosen because it is not spoken for: every letter combination a browser
	 * leaves alone is already a terminal binding, and a hotkey that steals one
	 * would break the thing this view exists to drive.
	 */
	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== ';' || !(e.ctrlKey || e.metaKey) || !onmic) return;
			e.preventDefault();
			onmic();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-page">
	<div
		bind:this={screen}
		onscroll={() => {
			if (screen) stuck = screen.scrollTop + screen.clientHeight >= screen.scrollHeight - 24;
		}}
		class="term min-h-0 w-full flex-1 overflow-auto px-3 py-2 leading-[1.35]"
		style="font-size: {mono}px"
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- ansiToHtml escapes its input -->
		<pre class="whitespace-pre">{@html ansiToHtml(text, true)}</pre>
	</div>

	<div
		class="flex shrink-0 items-center gap-1 border-t border-hairline bg-card px-2 py-1.5"
		style="padding-bottom: max(0.375rem, env(safe-area-inset-bottom))"
	>
		<span class="shrink-0 font-mono text-[13px] text-working" aria-hidden="true">&rsaquo;</span>
		<input
			bind:this={input}
			bind:value={draft}
			onkeydown={onKeydown}
			disabled={busy}
			class="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none disabled:opacity-50"
			style="font-size: {mono + 1}px"
			placeholder="type here, as you would in the pane"
			aria-label="Send to this pane"
			autocomplete="off"
			autocapitalize="off"
			autocorrect="off"
			spellcheck="false"
		/>
		{#each [{ k: 'esc', l: 'esc' }, { k: 'tab', l: 'tab' }] as key (key.k)}
			<button
				class="shrink-0 rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[11px] text-muted"
				onclick={() => onkeys([key.k])}>{key.l}</button
			>
		{/each}
		{#if onmic}
			<button
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {dictating
					? 'bg-blocked-bg text-blocked-ink'
					: 'text-muted'}"
				aria-label={dictating ? 'Stop dictating' : 'Dictate — Ctrl+;'}
				aria-pressed={dictating}
				title={dictating ? 'Stop dictating' : 'Dictate (Ctrl+;)'}
				onclick={onmic}
			>
				<Icon name="mic" size={18} />
			</button>
		{/if}
		<button
			class="shrink-0 rounded-md bg-working px-2 py-1 font-mono text-[11px] text-white"
			onclick={() => void submit()}
			disabled={busy}>enter</button
		>
	</div>
</div>
