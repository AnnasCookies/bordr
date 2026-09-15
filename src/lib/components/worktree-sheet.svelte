<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { track } from '$lib/pending.svelte';
	import Spinner from './spinner.svelte';
	import { collapseHome } from '$lib/grouping';
	import type { WorktreeList } from '$lib/server/herdr/controls';

	/**
	 * The repository's checkouts, and a new one.
	 *
	 * Starting a branch means walking to the desk, making a worktree, opening
	 * a workspace on it and starting an agent there — four steps that have to
	 * happen before any work can. herdr does all of it in one call, so the
	 * phone can have the branch waiting by the time you sit down.
	 *
	 * Addressed by a PANE rather than a path, because the pane says which
	 * machine the repository is on. A bare path stops meaning one thing the
	 * moment a second machine is connected.
	 */
	let {
		pane,
		cwd,
		onclose,
		ondone
	}: {
		/** The pane whose repository this is, machine prefix and all. */
		pane: string;
		cwd: string;
		onclose: () => void;
		ondone: () => void;
	} = $props();

	/**
	 * The pane and directory as they were when this opened.
	 *
	 * `detail.cwd` is the AGENT's working directory, read out of its transcript
	 * — so it moves the moment a tool call does a `cd`, several times a minute
	 * on a busy pane. Following it re-ran the load and blanked the list on
	 * every poll, which is the flicker. The repository does not change because
	 * a command changed directory inside it.
	 */
	const openedFor = untrack(() => ({ pane, cwd }));

	let list = $state<WorktreeList | null>(null);
	let loading = $state(true);
	let failed = $state<string | null>(null);
	let branch = $state('');
	let base = $state('');
	let busy = $state('');

	async function load() {
		// Only the FIRST read blanks the list. A refresh after creating or
		// opening one already has something to show, and swapping it for a
		// spinner is a flash that says nothing.
		loading = list === null;
		failed = null;
		try {
			const response = await fetch(
				`/api/worktrees?pane=${encodeURIComponent(openedFor.pane)}&cwd=${encodeURIComponent(openedFor.cwd)}`
			);
			const body = await response.json();
			// herdr's own sentence — "requires a path inside a Git work tree" —
			// rather than a status code, because it says what to do next.
			if (!response.ok) failed = (body as { message?: string }).message ?? 'Could not read them.';
			else list = body as WorktreeList;
		} catch (e) {
			failed = `Could not reach bordr: ${(e as Error).message}`;
		}
		loading = false;
	}

	/**
	 * Once, on mount.
	 *
	 * NOT an `$effect`. `load` reads `list` to decide whether to blank it, and
	 * an effect tracks every state read in its synchronous part — so writing
	 * `list` at the end of the load retriggered the effect that started it.
	 * Measured before this was moved: 338 requests on open and 3,058 within
	 * fourteen seconds, which is the flicker.
	 *
	 * The sheet is mounted fresh each time it is opened, so mount IS once.
	 */
	onMount(() => void load());

	async function act(action: 'create' | 'open', extra: Record<string, string> = {}) {
		if (busy) return;
		busy = action + (extra.path ?? '');
		failed = null;
		try {
			const response = await track(() =>
				fetch('/api/worktrees', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						action,
						pane: openedFor.pane,
						cwd: openedFor.cwd,
						branch,
						base,
						...extra
					})
				})
			);
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { message?: string } | null;
				failed = body?.message ?? `That did not work (${response.status}).`;
				busy = '';
				return;
			}
			branch = '';
			base = '';
			ondone();
			await load();
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
		class="relative max-h-[85dvh] w-full max-w-screen-sm overflow-y-auto rounded-t-2xl border-t border-hairline bg-card pb-[env(safe-area-inset-bottom)]"
		role="dialog"
		aria-label="Worktrees"
	>
		<p class="px-4 pt-3 pb-1 font-mono text-[11px] text-faint">
			worktrees{list?.repo ? ` · ${list.repo}` : ''}
		</p>

		{#if failed}
			<p
				role="alert"
				class="mx-4 mb-2 rounded-lg border border-blocked-edge bg-blocked-surface px-2.5 py-1.5 text-[12.5px] text-blocked-ink"
			>
				{failed}
			</p>
		{/if}

		<div class="px-4 pb-3">
			<label class="block">
				<span class="mb-1 block text-[12px] text-muted">New branch</span>
				<input
					bind:value={branch}
					placeholder="feat/something"
					class="w-full rounded-lg border border-edge bg-page px-3 py-2 text-[16px]"
				/>
			</label>
			<label class="mt-2 block">
				<span class="mb-1 block text-[12px] text-muted">
					From <span class="text-faint">— empty branches off wherever you are now</span>
				</span>
				<input
					bind:value={base}
					placeholder="main"
					class="w-full rounded-lg border border-edge bg-page px-3 py-2 text-[16px]"
				/>
			</label>
			<button
				class="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink text-[14px] font-medium text-card disabled:opacity-50"
				onclick={() => act('create')}
				disabled={!!busy || !branch.trim()}
			>
				{#if busy === 'create'}<Spinner size={13} label="Creating" />{/if}
				Create the worktree and a workspace for it
			</button>
			<!--
				Not focused on purpose. The point of doing this from a phone is to
				have the branch waiting, not to yank the terminal onto it while
				somebody is looking at that screen.
			-->
			<p class="mt-1.5 text-[11.5px] text-faint">
				It is left in the background; focus it when you get to the desk.
			</p>
		</div>

		<div class="border-t border-hairline">
			<p class="px-4 pt-2 pb-1 font-mono text-[10.5px] tracking-[.06em] text-faint uppercase">
				already checked out
			</p>
			{#if loading}
				<p class="flex items-center gap-2 px-4 pb-3 text-[13px] text-muted">
					<Spinner size={13} label="Loading" /> Reading the repository…
				</p>
			{:else}
				<ul class="divide-y divide-black/[.06] dark:divide-white/[.06]">
					{#each list?.worktrees ?? [] as tree (tree.path)}
						<li class="flex items-center gap-2 px-4 py-2">
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[13.5px]">
									{tree.branch || 'detached'}
									{#if !tree.linked}<span class="ml-1 font-mono text-[10px] text-faint">source</span
										>{/if}
									{#if tree.prunable}<span class="ml-1 font-mono text-[10px] text-blocked-ink"
											>gone</span
										>{/if}
								</span>
								<span class="block truncate font-mono text-[11px] text-muted"
									>{collapseHome(tree.path)}</span
								>
							</span>
							<button
								class="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-chip px-3 text-[12.5px] disabled:opacity-50"
								onclick={() => act('open', { path: tree.path })}
								disabled={!!busy}
							>
								{#if busy === `open${tree.path}`}<Spinner size={11} label="Opening" />{/if}
								Open
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<button
			class="min-h-12 w-full border-t border-hairline px-4 text-left text-[15px] text-muted"
			onclick={onclose}>Done</button
		>
	</div>
</div>
