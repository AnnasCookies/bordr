<script lang="ts">
	import { track } from '$lib/pending.svelte';
	import Spinner from './spinner.svelte';

	/**
	 * herdr's controls for one workspace, tab or pane.
	 *
	 * bordr could see the shape of a session and change nothing about it: the
	 * tabs, the panes and their names were read-only. These are the three
	 * changes worth making from a phone — put it on the terminal's screen, name
	 * it, or close it — and nothing else herdr offers is either.
	 *
	 * Close asks twice, in place. A confirm() would be a second dialog over a
	 * sheet on a 400px screen, and swapping the button for its own confirmation
	 * puts the question where the thumb already is.
	 */
	export type ControlScope = 'pane' | 'tab' | 'workspace';

	export interface ControlTarget {
		scope: ControlScope;
		/** The bordr address, machine prefix and all. */
		id: string;
		/** What it is called now, as the rename box's starting point. */
		label: string;
	}

	let {
		targets,
		onclose,
		ondone
	}: {
		/**
		 * What this sheet can act on, in the order they are offered.
		 *
		 * More than one because a pane and the tab holding it are both worth
		 * renaming and both reached from the same place — and a second button in
		 * the header, or a second sheet, would be chrome for a switch this can
		 * make itself.
		 */
		targets: ControlTarget[];
		onclose: () => void;
		/** Something changed; the caller refetches its tree. */
		ondone: () => void;
	} = $props();

	let chosen = $state(0);
	const target = $derived(targets[Math.min(chosen, targets.length - 1)]);
	const scope = $derived(target.scope);
	const id = $derived(target.id);
	const label = $derived(target.label);

	/**
	 * The name box starts from the current name and is then the reader's.
	 *
	 * Reset when the sheet is pointed at something else, and NOT when `label`
	 * changes underneath — the tree repolls every few seconds, so resyncing on
	 * the label would wipe whatever was half-typed each time it did.
	 */
	let name = $state('');
	let shownFor = $state('');
	$effect(() => {
		if (shownFor === id) return;
		shownFor = id;
		name = label;
	});
	let busy = $state('');
	let failed = $state<string | null>(null);
	let confirming = $state(false);

	async function send(action: 'focus' | 'rename' | 'close') {
		if (busy) return;
		busy = action;
		failed = null;
		try {
			const response = await track(() =>
				fetch('/api/control', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ action, scope, id, label: name })
				})
			);
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { message?: string } | null;
				// herdr's own refusal, not a status code: "tab w9:t99 not found"
				// tells you what to do about it and "409" does not.
				failed = body?.message ?? `That did not work (${response.status}).`;
				busy = '';
				return;
			}
			ondone();
			onclose();
		} catch (e) {
			failed = `Nothing was sent: ${(e as Error).message}`;
		}
		busy = '';
	}
</script>

<div class="fixed inset-0 z-50 flex items-end justify-center">
	<button class="no-press absolute inset-0 bg-black/40" aria-label="Close" onclick={onclose}
	></button>

	<div
		class="relative w-full max-w-screen-sm rounded-t-2xl border-t border-hairline bg-card pb-[env(safe-area-inset-bottom)]"
		role="dialog"
		aria-label="{scope} controls"
	>
		{#if targets.length > 1}
			<div class="flex gap-1 px-4 pt-3">
				{#each targets as option, i (option.id)}
					<button
						class="min-h-8 rounded-full px-3 font-mono text-[11px] {i === chosen
							? 'bg-ink text-card'
							: 'bg-chip text-muted'}"
						aria-pressed={i === chosen}
						onclick={() => {
							chosen = i;
							confirming = false;
							failed = null;
						}}>{option.scope}</button
					>
				{/each}
			</div>
		{/if}
		<p class="truncate px-4 pt-2 pb-1 font-mono text-[11px] text-faint">
			{label || id}
		</p>

		{#if failed}
			<p
				role="alert"
				class="mx-4 mb-2 rounded-lg border border-blocked-edge bg-blocked-surface px-2.5 py-1.5 text-[12.5px] text-blocked-ink"
			>
				{failed}
			</p>
		{/if}

		<div class="px-4 pb-2">
			<label class="block">
				<span class="mb-1 block text-[12px] text-muted">Name</span>
				<div class="flex gap-2">
					<input
						bind:value={name}
						placeholder={scope === 'pane' ? 'Leave empty to clear' : `Name this ${scope}`}
						class="min-w-0 flex-1 rounded-lg border border-edge bg-page px-3 py-2 text-[16px]"
					/>
					<button
						class="flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-ink px-3.5 text-[13px] font-medium text-card disabled:opacity-50"
						onclick={() => send('rename')}
						disabled={!!busy || (name.trim() === label.trim() && scope !== 'pane')}
					>
						{#if busy === 'rename'}<Spinner size={13} label="Renaming" />{/if}
						Rename
					</button>
				</div>
			</label>
		</div>

		<div
			class="flex flex-col divide-y divide-black/[.06] border-t border-hairline dark:divide-white/[.06]"
		>
			<button
				class="flex min-h-12 items-center gap-2 px-4 text-left text-[15px]"
				onclick={() => send('focus')}
				disabled={!!busy}
			>
				{#if busy === 'focus'}<Spinner size={14} label="Focusing" />{/if}
				<span class="flex-1">Show on the terminal</span>
				<span class="font-mono text-[11px] text-faint">focus</span>
			</button>

			{#if scope !== 'workspace'}
				{#if confirming}
					<!-- The question where the thumb already is, rather than a second
					     dialog stacked over a sheet on a 400px screen. -->
					<div class="flex min-h-12 items-center gap-2 px-4">
						<span class="flex-1 text-[14px]">Close this {scope}?</span>
						<button
							class="min-h-9 rounded-full bg-chip px-3 text-[13px]"
							onclick={() => (confirming = false)}>Keep</button
						>
						<button
							class="flex min-h-9 items-center gap-1.5 rounded-full bg-blocked px-3 text-[13px] font-medium text-card disabled:opacity-50"
							onclick={() => send('close')}
							disabled={!!busy}
						>
							{#if busy === 'close'}<Spinner size={12} label="Closing" />{/if}
							Close it
						</button>
					</div>
				{:else}
					<button
						class="flex min-h-12 items-center px-4 text-left text-[15px] text-blocked-ink"
						onclick={() => (confirming = true)}
						disabled={!!busy}
					>
						<span class="flex-1">Close this {scope}</span>
						<span class="font-mono text-[11px] text-faint">ends what is running</span>
					</button>
				{/if}
			{/if}

			<button class="min-h-12 px-4 text-left text-[15px] text-muted" onclick={onclose}
				>Cancel</button
			>
		</div>
	</div>
</div>
