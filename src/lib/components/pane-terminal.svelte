<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { ansiToHtml } from '$lib/ansi';
	import { prefs } from '$lib/prefs.svelte';
	import { promptMark, splitAtPrompt } from '$lib/screen-split';
	import Icon from './icon.svelte';
	import StatusBlock from './status-block.svelte';

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
		agent = '',
		draft = $bindable(''),
		ask,
		lines = 200,
		mono = 12,
		dictating = false,
		onkeys,
		onmic,
		busy = false
	}: {
		paneId: string;
		/** Which harness, so the status block remembers the row per harness. */
		agent?: string;
		/** Bound, so dictation writes into this line the way it does the composer. */
		draft?: string;
		/** The harness's question, when it has one — shown above the prompt. */
		ask?: Snippet;
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

	// The screen follows its own bottom, the way a terminal does, unless you
	// have scrolled up to read something.
	$effect(() => {
		void text;
		if (stuck && screen) screen.scrollTop = screen.scrollHeight;
	});

	/**
	 * Shrink the type until the pane's own width fits the window's.
	 *
	 * herdr draws a pane at the terminal's width — 198 columns here — and
	 * bordr only displays what it drew. On a phone that is four times the
	 * screen, so without this every line runs off the side and reading
	 * anything means scrolling sideways. Scaling the type keeps the columns
	 * lined up, which wrapping would destroy: a status bar, a table and a
	 * progress meter are all built out of column positions.
	 *
	 * Down to a floor only. Past that it stops being legible and buys nothing —
	 * a 198-column pane needs about 3px a character to fit a phone, which is
	 * not reading, it is a texture. Below the floor, sideways scrolling is the
	 * better of two bad answers.
	 */
	const FLOOR = 8;
	let fitted = $state(0);
	const mode = $derived(prefs.value.terminalFit);
	const size = $derived(mode === 'fit' ? fitted || mono : mono);

	function fit() {
		if (mode !== 'fit') {
			fitted = 0;
			return;
		}
		const box = screen;
		const pre = box?.firstElementChild as HTMLElement | undefined;
		if (!box || !pre || !box.clientWidth) return;
		// Measure at the SOURCE size, so the answer does not drift each time
		// it is recomputed from its own previous result.
		const at = fitted || mono;
		const natural = (pre.scrollWidth / at) * mono;
		if (!natural) return;
		const want = Math.min(mono, (box.clientWidth / natural) * mono);
		fitted = Math.max(FLOOR, Math.floor(want * 10) / 10);
	}

	$effect(() => {
		void text;
		void mono;
		void mode;
		// After the paint: scrollWidth is only true once the new text is in.
		const id = requestAnimationFrame(fit);
		return () => cancelAnimationFrame(id);
	});

	$effect(() => {
		const box = screen;
		if (!box) return;
		// The window resizing, the split moving, the keyboard opening — all
		// change the width without changing a character of the text.
		const observer = new ResizeObserver(() => fit());
		observer.observe(box);
		return () => observer.disconnect();
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

	/**
	 * Put what has been typed into the pane, once.
	 *
	 * Typing used to go through a character at a time so it appeared in the
	 * harness's own box. It did — and every keystroke waited on a round trip,
	 * which is unusable on a phone. The box now sits WHERE that line is drawn
	 * instead, so the text is already in the right place on screen and only
	 * has to reach the pane when the pane needs it: on Enter, and before Tab
	 * or history, which cannot work on text the pane has never seen.
	 */
	async function flush(): Promise<boolean> {
		if (composing || !draft) return true;
		const chunk = draft;
		draft = '';
		let ok = true;
		await enqueue(async () => {
			ok = await type(chunk);
			// Back in the box rather than lost.
			if (!ok) draft = chunk + draft;
			return ok;
		});
		return ok;
	}

	async function submit() {
		if (!(await flush())) return;
		await onkeys(['enter']);
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
		// Completion and history act on the pane's line, so it has to be the
		// pane's line first.
		void (async () => {
			if (key === 'tab' || key === 'up' || key === 'down') await flush();
			await onkeys([key]);
		})();
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
		style="font-size: {size}px"
	>
		<!-- eslint-disable svelte/no-at-html-tags -- ansiToHtml escapes its input -->
		<pre
			class={mode === 'wrap'
				? '[overflow-wrap:anywhere] whitespace-pre-wrap'
				: 'whitespace-pre'}>{@html ansiToHtml(parts.above.join('\n'), true)}</pre>
		<!-- eslint-enable svelte/no-at-html-tags -->
	</div>

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
		Where the harness draws its prompt, this is the prompt: same marker,
		same place on the screen, and the text you type is already in the right
		spot without a round trip per character.
	-->
	<div
		class="flex shrink-0 items-center gap-1 border-t border-hairline bg-card px-2 py-1.5"
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

	{#if footer.length > 0 && prefs.value.statusPosition === 'bottom'}
		<div class="shrink-0 border-t border-hairline bg-page pt-1.5">
			<StatusBlock
				rows={footer}
				{agent}
				open={statusOpen}
				ontoggle={() => (statusOpen = !statusOpen)}
			/>
		</div>
	{/if}
</div>
