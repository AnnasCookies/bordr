<script lang="ts">
	import Spinner from './spinner.svelte';
	import { track } from '$lib/pending.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { replacesHistory } from '$lib/back';
	import { prefs } from '$lib/prefs.svelte';
	import { harnessText } from '$lib/theme';

	let { open, onclose }: { open: boolean; onclose: () => void } = $props();

	/** Every kind the server's KINDS set accepts. */
	const KINDS = [
		'claude',
		'codex',
		'pi',
		'omp',
		'grok',
		'agy',
		'gemini',
		'cursor',
		'copilot',
		'opencode'
	];

	let kind = $state('');
	let cwd = $state('');
	let label = $state('');
	let prompt = $state('');
	let spawning = $state(false);
	/** Inline, not alert(): a system modal over a home-screen PWA is jarring. */
	let error = $state('');
	/** Held in script because the hint itself contains quote characters. */
	const LABEL_HINT = 'Defaults to the kind, e.g. "claude"';
	let dirs = $state<string[]>([]);
	let parent = $state<string | null>(null);
	let loadingDirs = $state(false);
	/** Why the listing is empty when it is not simply an empty folder. */
	let dirError = $state<string | null>(null);
	let folderName = $state('');
	let creatingFolder = $state(false);
	let folderError = $state<string | null>(null);

	async function browse(path?: string) {
		loadingDirs = true;
		dirError = null;
		folderError = null;
		try {
			const url = path ? `/api/dirs?path=${encodeURIComponent(path)}` : '/api/dirs';
			const response = await fetch(url);
			const body = (await response.json()) as {
				path: string;
				display?: string;
				parent: string | null;
				dirs: string[];
				error?: string;
				message?: string;
			};
			// The walker answers 200 with an `error` for a refused path ("outside
			// home", "not readable"); a bare status is the fallback for anything else.
			if (!response.ok) throw new Error(body.message ?? `dirs failed: ${response.status}`);
			cwd = body.display ?? body.path;
			dirs = body.dirs;
			parent = body.parent;
			if (body.error) dirError = `Could not list it: ${body.error}.`;
		} catch (e) {
			dirs = [];
			dirError = `Could not list it: ${(e as Error).message}.`;
		}
		loadingDirs = false;
	}

	async function createFolder() {
		if (!folderName.trim() || creatingFolder) return;
		creatingFolder = true;
		folderError = null;
		try {
			const response = await fetch('/api/dirs', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ parent: cwd || undefined, name: folderName })
			});
			const body = (await response.json()) as { path?: string; message?: string };
			if (!response.ok || !body.path) {
				throw new Error(body.message ?? `create folder failed: ${response.status}`);
			}
			folderName = '';
			await browse(body.path);
		} catch (e) {
			folderError = (e as Error).message;
		}
		creatingFolder = false;
	}

	// Load the walker the first time the sheet opens, not on every render.
	let loaded = false;
	$effect(() => {
		if (open && !loaded) {
			loaded = true;
			void browse();
		}
	});

	async function start() {
		const hasPrompt = prompt.trim().length > 0;
		if (!kind || (kind === 'omp' && !hasPrompt)) return;
		spawning = true;
		error = '';
		try {
			const response = await track(() =>
				fetch('/api/agents/new', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						kind,
						cwd,
						label: label.trim() || undefined,
						prompt: kind === 'omp' ? prompt : undefined
					})
				})
			);
			const result = (await response.json()) as { paneId?: string; message?: string };
			if (!response.ok || !result.paneId) throw new Error(result.message ?? 'spawn failed');
			// Pushed from the list, replaced from anywhere else: see $lib/back.
			await goto(resolve('/a/[pane]', { pane: result.paneId }), {
				replaceState: replacesHistory(prefs.value.backTo, page.url.pathname)
			});
			onclose();
		} catch (e) {
			error = (e as Error).message;
		}
		spawning = false;
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-40"
		style="background: var(--scrim)"
		onclick={onclose}
		aria-hidden="true"
	></div>
	<div
		class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[88dvh] max-w-screen-sm overflow-y-auto rounded-t-[28px] bg-page shadow-[0_-10px_40px_rgba(0,0,0,.25)] motion-safe:animate-[bordr-rise_240ms_cubic-bezier(.2,.8,.2,1)]"
		style="padding-bottom: max(1rem, env(safe-area-inset-bottom))"
		role="dialog"
		aria-modal="true"
		aria-label="New agent"
	>
		<div class="flex justify-center pt-2.5 pb-1">
			<span class="h-[5px] w-9 rounded-full bg-idle-rail"></span>
		</div>
		<div class="flex items-center px-4 py-2">
			<button class="min-h-11 text-[15px] text-working" onclick={onclose}>Cancel</button>
			<h2 class="flex-1 text-center text-[17px] font-semibold">New agent</h2>
			<button
				class="flex min-h-11 items-center gap-1.5 text-[15px] {kind
					? 'text-working'
					: 'text-faint'}"
				disabled={!kind || spawning || (kind === 'omp' && !prompt.trim())}
				onclick={start}
			>
				{#if spawning}<Spinner size={13} label="Starting" />{/if}
				Start
			</button>
		</div>

		<div class="space-y-4 px-4 pt-1">
			<section>
				<h3 class="mb-1.5 font-mono text-[10.5px] text-muted">kind</h3>
				<div class="flex flex-wrap gap-1.5">
					{#each KINDS as k (k)}
						<button
							class="rounded-full border px-3 py-2 text-[13px] {kind === k
								? `bg-card ${harnessText(k)} border-current`
								: 'border-transparent bg-chip text-muted'}"
							onclick={() => (kind = k)}
						>
							{k}
						</button>
					{/each}
				</div>
			</section>

			{#if kind === 'omp'}
				<section>
					<h3 class="mb-1.5 font-mono text-[10.5px] text-muted">
						first message · required for OMP
					</h3>
					<textarea
						bind:value={prompt}
						rows="3"
						placeholder="What do you want OMP to do?"
						class="w-full resize-y rounded-xl border border-edge bg-card px-3 py-2.5 text-[16px] placeholder:text-faint"
					></textarea>
				</section>
			{/if}

			<section>
				<h3 class="mb-1.5 font-mono text-[10.5px] text-muted">cwd · confined to ~</h3>
				<div class="overflow-hidden rounded-xl border border-hairline bg-card">
					<div class="flex items-center gap-2 border-b border-hairline px-3 py-2">
						<span class="min-w-0 flex-1 truncate font-mono text-[12.5px]">{cwd || '~'}</span>
						{#if parent}
							<button
								class="shrink-0 font-mono text-[12.5px] text-working"
								onclick={() => browse(parent as string)}>⬑ up</button
							>
						{/if}
					</div>
					<form
						class="flex items-center gap-2 border-b border-hairline bg-page px-2 py-2"
						onsubmit={(event) => {
							event.preventDefault();
							void createFolder();
						}}
					>
						<input
							bind:value={folderName}
							class="min-w-0 flex-1 rounded-lg border border-edge bg-card px-2.5 py-2 text-[15px]"
							placeholder="New folder name"
							aria-label="New folder name"
						/>
						<button
							type="submit"
							class="flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-card disabled:opacity-50"
							disabled={!folderName.trim() || creatingFolder}
						>
							{#if creatingFolder}<Spinner size={12} label="Creating folder" />{/if}
							Create &amp; open
						</button>
					</form>
					{#if folderError}
						<p
							class="border-b border-hairline bg-danger-bg px-3 py-2 text-[12px] text-danger-ink"
							role="alert"
						>
							{folderError}
						</p>
					{/if}
					<div class="max-h-52 overflow-y-auto">
						{#each dirs as dir (dir)}
							<button
								class="flex w-full items-center gap-2 border-b border-hairline px-3 py-2.5 text-left last:border-b-0"
								onclick={() => browse(`${cwd}/${dir}`)}
							>
								<span class="h-[18px] w-[22px] shrink-0 rounded bg-folder-chip"></span>
								<span class="min-w-0 flex-1 truncate font-mono text-[13px]">{dir}</span>
							</button>
						{:else}
							<p class="px-3 py-3 text-center text-[12px] text-muted" role="status">
								{loadingDirs ? 'Reading…' : (dirError ?? 'No sub-folders here.')}
							</p>
						{/each}
					</div>
				</div>
			</section>

			<section>
				<h3 class="mb-1.5 font-mono text-[10.5px] text-muted">label · optional</h3>
				<input
					bind:value={label}
					placeholder={LABEL_HINT}
					class="w-full rounded-xl border border-edge bg-card px-3 py-2.5 text-[16px] placeholder:text-faint"
				/>
			</section>

			<button
				class="flex w-full items-center justify-center gap-2 rounded-[14px] bg-ink px-4 py-[15px] text-[16px] font-semibold text-card disabled:opacity-50"
				disabled={!kind || spawning || (kind === 'omp' && !prompt.trim())}
				onclick={start}
			>
				{#if spawning}<Spinner size={15} label="Starting" />{/if}
				{spawning
					? 'Starting…'
					: kind === 'omp'
						? `Start OMP and send in ${cwd || '~'}`
						: `Start ${kind || 'agent'} in ${cwd || '~'}`}
			</button>

			{#if error}
				<p class="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[12.5px] text-danger-ink">{error}</p>
			{/if}

			<p class="pb-2 text-center text-[11px] text-faint">
				workspace.create → agent.start · first-run prompts open as a picker
			</p>
		</div>
	</div>
{/if}
