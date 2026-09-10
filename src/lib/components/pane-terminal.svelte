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
		onkeys: (keys: string[]) => Promise<void> | void;
		onmic?: () => void;
		busy?: boolean;
	} = $props();

	let text = $state('');
	let screen = $state<HTMLElement | undefined>();
	let input = $state<HTMLInputElement | undefined>();
	let stuck = $state(true);

	/** The pane the screen on show belongs to. */
	let shownFor = '';

	async function load(id: string) {
		// Clearing here rather than in the effect: an effect that WRITES the
		// state it owns re-runs itself, so `text = ''` there blanked and
		// refetched the screen every single poll — which is what the flicker
		// was. Measured: seven blank-then-refill cycles in nine seconds on a
		// pane whose text never changed.
		if (id !== shownFor) {
			shownFor = id;
			text = '';
		}
		try {
			const res = await fetch(
				`/api/agents/${encodeURIComponent(id)}/read?lines=${lines}&ansi=1&source=visible`
			);
			if (!res.ok) return;
			const next = (await res.json()).text ?? '';
			// Only when it CHANGED. Reassigning the same screen every second
			// rebuilt the whole block of markup for nothing, and that rebuild is
			// what the flicker was — an idle pane was being repainted once a
			// second with identical content.
			if (next !== text) text = next;
		} catch {
			// A dropped poll leaves the last screen up rather than blanking it.
		}
	}

	$effect(() => {
		const id = paneId;
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

	/**
	 * Typing goes THROUGH to the pane, character by character.
	 *
	 * The point of terminal mode is that the harness's own input box is where
	 * your text appears — its history, its completion, its `!` and `/` modes
	 * all live there and none of them can see a line bordr is holding. So each
	 * keystroke is sent as it happens and this field empties behind it.
	 *
	 * The field still exists because a soft keyboard needs one, and because a
	 * failed send has to leave your text somewhere.
	 */
	let composing = false;
	let queue: Promise<void> = Promise.resolve();
	let failed = $state(false);

	/** Serialised: two keystrokes racing would arrive in either order. */
	function enqueue(work: () => Promise<boolean>) {
		queue = queue.then(async () => {
			failed = !(await work());
		});
		return queue;
	}

	async function type(chunk: string): Promise<boolean> {
		try {
			const res = await fetch(`/api/agents/${encodeURIComponent(paneId)}/type`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: chunk })
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	function onInput() {
		// Mid-composition (IME, or a phone's autocorrect mid-word) the value is
		// not yet what anyone meant to type.
		if (composing || !draft) return;
		const chunk = draft;
		draft = '';
		void enqueue(async () => {
			const ok = await type(chunk);
			// Put it back rather than losing it, and stop typing through until
			// the next keystroke proves the channel is up again.
			if (!ok) draft = chunk + draft;
			return ok;
		});
	}

	async function submit() {
		// Anything still in the field has not reached the pane yet — a failed
		// send, or a composition that never fired input.
		const rest = draft;
		draft = '';
		if (rest) await enqueue(() => type(rest));
		await onkeys(['enter']);
		input?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			void submit();
			return;
		}
		// Backspace unsays a character in the PANE, since that is where the
		// characters went; the field behind it is already empty.
		if (event.key === 'Backspace' && !draft) {
			event.preventDefault();
			void onkeys(['backspace']);
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
			oninput={onInput}
			oncompositionstart={() => (composing = true)}
			oncompositionend={() => {
				composing = false;
				onInput();
			}}
			onkeydown={onKeydown}
			disabled={busy}
			class="min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none disabled:opacity-50"
			style="font-size: {mono + 1}px"
			placeholder={failed
				? 'could not reach the pane — press enter to retry'
				: 'type — it goes into the pane'}
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
