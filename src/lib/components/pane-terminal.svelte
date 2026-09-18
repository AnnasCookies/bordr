<script module lang="ts">
	export interface TerminalAnswerTarget {
		paneId: string;
		dialog: string;
		index: number;
	}
</script>

<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { prefs } from '$lib/prefs.svelte';
	import { promptMark, splitAtPrompt } from '$lib/screen-split';
	import Icon from './icon.svelte';
	import StatusBlock from './status-block.svelte';
	import TerminalSurface from './terminal-surface.svelte';

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
		dialog = '',
		writeIn = null,
		agent = '',
		draft = $bindable(''),
		ask,
		suggestion = '',
		lines = 200,
		mono = 12,
		dictating = false,
		onkeys,
		onmic,
		onsubmit,
		onrestore,
		input = $bindable(),
		busy = false
	}: {
		paneId: string;
		dialog?: string;
		writeIn?: TerminalAnswerTarget | null;
		/** Which harness, so the status block remembers the row per harness. */
		agent?: string;
		/** Bound, so dictation writes into this line the way it does the composer. */
		draft?: string;
		/** The harness's question, when it has one — shown above the prompt. */
		ask?: Snippet;
		/** The harness's own ghost prompt, offered above the input. */
		suggestion?: string;
		lines?: number;
		mono?: number;
		dictating?: boolean;
		onkeys: (keys: string[], paneId: string) => Promise<boolean>;
		onsubmit?: (target: TerminalAnswerTarget, text: string) => Promise<boolean>;
		onrestore: (paneId: string, text: string) => void;
		input?: HTMLInputElement;
		onmic?: () => void;
		busy?: boolean;
	} = $props();

	let text = $state('');

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
				`/api/agents/${encodeURIComponent(id)}/read?lines=${lines}&ansi=1&source=recent`
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

	const parts = $derived(splitAtPrompt(text));
	const mark = $derived(parts.prompt ? promptMark(parts.prompt) : '\u203a');
	/**
	 * The harness's own footer, handed to the block that knows how to park it.
	 *
	 * Condensed the same way the server condenses the rows it lifts off a
	 * screen: a footer is laid out in terminal columns, so expanded it arrives
	 * full of the runs of spaces that did the aligning, and those read as gaps
	 * once the line is allowed to wrap.
	 */
	const footer = $derived(
		parts.below.map((l) => l.trim().replace(/\s{2,}/g, '  ')).filter((l) => l !== '')
	);
	let statusOpen = $state(false);

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

	// Pane/dialog changes invalidate every queued continuation, including an A → B → A trip.
	let generation = 0;
	const owner = $derived(`${paneId}\0${dialog}`);
	$effect(() => {
		void owner;
		generation++;
		return () => {
			generation++;
		};
	});

	const unsent = new SvelteSet<{ paneId: string; epoch: number; text: string }>();
	function recover(paneId: string, epoch: number) {
		const items = [...unsent].filter((item) => item.paneId === paneId && item.epoch === epoch);
		for (const item of items) unsent.delete(item);
		const text = items
			.map((item) => item.text)
			.filter(Boolean)
			.join('\n');
		if (text) onrestore(paneId, text);
	}

	function dispatch(keys: string[], flush = false, answer?: TerminalAnswerTarget) {
		if (composing || busy) return;
		const origin = paneId;
		const epoch = generation;
		const originDialog = dialog;
		const submitAnswer = onsubmit;
		const chunk = flush ? draft : '';
		if (answer && !chunk.trim()) return;
		const item = { paneId: origin, epoch, text: chunk };
		unsent.add(item);
		if (flush) draft = '';
		const valid = () => generation === epoch && paneId === origin && dialog === originDialog;
		queue = queue.then(async () => {
			if (!valid()) {
				recover(origin, epoch);
				return;
			}
			try {
				if (answer) {
					if (!submitAnswer || !(await submitAnswer(answer, chunk.trim())))
						throw new Error('answer refused');
					unsent.delete(item);
					// An answer can replace the dialog before polling sees it. Retire its queue now.
					recover(origin, epoch);
					if (generation === epoch) generation++;
					return;
				}
				if (chunk) {
					const res = await fetch(`/api/agents/${encodeURIComponent(origin)}/type`, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ text: chunk })
					});
					if (!res.ok) throw new Error('type refused');
				}
				unsent.delete(item);
				if (valid()) {
					const ok = await onkeys(keys, origin);
					if (valid()) {
						failed = !ok;
						if (!ok) {
							recover(origin, epoch);
							generation++;
						}
					}
				}
			} catch {
				recover(origin, epoch);
				if (valid()) {
					failed = true;
					generation++;
				}
			}
		});
	}

	function submit() {
		// Snapshot the selected row and text at enqueue time, not when earlier I/O finishes.
		dispatch(['enter'], true, writeIn && onsubmit ? { ...writeIn } : undefined);
		input?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			void submit();
			return;
		}
		// With an empty box there is nothing here to erase, so the backspace is
		// meant for whatever the pane already has on its line.
		if (event.key === 'Backspace' && !draft) {
			event.preventDefault();
			dispatch(['backspace']);
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
		// Shift+Tab is a different key from Tab, and the one a harness cycles
		// its mode with — sending plain `tab` for it would complete instead.
		const key = event.key === 'Tab' && event.shiftKey ? 'shift+tab' : passthrough[event.key];
		if (!key) return;
		event.preventDefault();
		// Completion and history act on the pane's line, so it has to be the
		// pane's line first.
		dispatch([key], key === 'tab' || key === 'up' || key === 'down');
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
	<TerminalSurface text={parts.above.join('\n')} {mono} />

	{#if ask}
		<!--
			A question belongs where the answer goes. In terminal mode the picker
			is on the screen as text you could type a number into, but the same
			card the conversation shows is a tap instead — and the pane cannot
			tell the difference.
		-->
		<div class="max-h-[45%] shrink-0 overflow-y-auto border-t border-hairline px-3 pb-2">
			{@render ask()}
		</div>
	{/if}

	{#if footer.length > 0 && prefs.value.statusPosition === 'header'}
		<div class="shrink-0 border-t border-hairline">
			<StatusBlock
				rows={footer}
				{agent}
				open={statusOpen}
				ontoggle={() => (statusOpen = !statusOpen)}
			/>
		</div>
	{/if}

	<!--
		The harness's own suggested prompt. Offered rather than sent: on a phone
		you cannot see what you are about to commit to the way you can in a
		terminal, and it is usually a starting point worth editing.
	-->
	{#if prefs.value.showSuggestions && suggestion && draft.trim() === ''}
		<button
			class="flex shrink-0 items-center gap-2 border-t border-hairline bg-card px-3 py-2 text-left"
			onclick={() => {
				draft = suggestion;
				input?.focus();
			}}
		>
			<span class="shrink-0 font-mono text-[12px] text-faint" aria-hidden="true">&rarr;</span>
			<span class="min-w-0 flex-1 truncate text-[13px] text-muted">{suggestion}</span>
		</button>
	{/if}

	<!--
		Where the harness draws its prompt, this is the prompt: same marker,
		same place on the screen, and the text you type is already in the right
		spot without a round trip per character.
	-->
	<div
		class="flex shrink-0 flex-wrap items-center gap-1 border-t border-hairline bg-card px-2 py-1.5"
		style="padding-bottom: {footer.length > 0 && prefs.value.statusPosition === 'bottom'
			? '0.375rem'
			: 'max(0.375rem, env(safe-area-inset-bottom))'}"
	>
		<span class="shrink-0 font-mono text-[13px] text-working" aria-hidden="true">{mark}</span>
		<input
			bind:this={input}
			bind:value={draft}
			oncompositionstart={() => (composing = true)}
			oncompositionend={() => (composing = false)}
			onkeydown={onKeydown}
			disabled={busy}
			class="min-w-[9rem] flex-1 bg-transparent font-mono text-[13px] outline-none disabled:opacity-50"
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
		{#each [{ k: 'esc', l: 'esc' }, { k: 'tab', l: 'tab' }, { k: 'shift+tab', l: '⇧⇥' }] as key (key.k)}
			<button
				class="shrink-0 rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[11px] text-muted"
				title={key.k === 'shift+tab' ? 'Cycle the harness mode (Shift+Tab)' : key.k}
				aria-label={key.k === 'shift+tab' ? 'Cycle the harness mode' : key.k}
				onclick={() => dispatch([key.k], key.k === 'tab')}>{key.l}</button
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

	{#if footer.length > 0 && prefs.value.statusPosition === 'bottom'}
		<!-- Last on the screen, so this block owns the safe area. -->
		<div
			class="shrink-0 border-t border-hairline bg-page pt-1.5"
			style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom))"
		>
			<StatusBlock
				rows={footer}
				{agent}
				open={statusOpen}
				ontoggle={() => (statusOpen = !statusOpen)}
			/>
		</div>
	{/if}
</div>
