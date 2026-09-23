<script lang="ts">
	import { onMount } from 'svelte';
	import SettingsNav from '$lib/components/settings-nav.svelte';
	import AppHeader from '$lib/components/app-header.svelte';
	import SessionTree from '$lib/components/session-tree.svelte';
	import TabBar from '$lib/components/tab-bar.svelte';
	import Spinner from '$lib/components/spinner.svelte';
	import { screen, watchWide } from '$lib/wide.svelte';

	interface Session {
		name: string;
		running: boolean;
		default: boolean;
		current: boolean;
	}
	interface Job {
		id: string;
		action: string;
		label: string;
		startedAt: number;
		output: string;
		done: boolean;
		code: number | null;
	}
	interface State {
		sessions: Session[];
		sessionsError: string | null;
		unit: { scope: 'user' | 'system'; unit: string } | null;
		commands: { id: string; label: string; confirm: boolean }[];
		commandsPath: string;
		commandsError: string | null;
		outdated: { tool: string; version: string; latest: string; pid: number; cwd: string }[];
		jobs: Job[];
	}

	/** One button: what it posts, and whether it asks first. */
	interface Row {
		key: string;
		action: string;
		name?: string;
		label: string;
		hint?: string;
		confirm: boolean;
		danger?: boolean;
	}

	let data = $state<State | null>(null);
	let loadError = $state('');
	let actionError = $state('');
	/** The row asking "are you sure", in place — never a confirm() dialog. */
	let confirming = $state<string | null>(null);
	let posting = $state<string | null>(null);

	async function refresh() {
		try {
			const r = await fetch('/api/system');
			if (!r.ok) throw new Error(await r.text());
			data = await r.json();
			loadError = '';
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	}

	const running = $derived(data?.jobs.some((j) => !j.done) ?? false);
	const busyActions = $derived(new Set(data?.jobs.filter((j) => !j.done).map((j) => j.action)));

	// Poll only while something runs. A job outlives any one request, so this
	// is how its output reaches the page — and how a job started from another
	// phone shows up here.
	$effect(() => {
		if (!running) return;
		const timer = setInterval(refresh, 1500);
		return () => clearInterval(timer);
	});

	async function run(row: Row) {
		confirming = null;
		actionError = '';
		posting = row.key;
		try {
			const r = await fetch('/api/system', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: row.action, name: row.name })
			});
			if (!r.ok) {
				const body = await r.json().catch(() => null);
				throw new Error(body?.message ?? `HTTP ${r.status}`);
			}
		} catch (e) {
			actionError = e instanceof Error ? e.message : String(e);
		} finally {
			posting = null;
			await refresh();
		}
	}

	function jobKey(row: Row): string {
		if (row.action === 'run') return `run:${row.name}`;
		if (row.action === 'stop-session' || row.action === 'delete-session') {
			return `${row.action}:${row.name}`;
		}
		return row.action;
	}

	const current = $derived(data?.sessions.find((s) => s.current));
	const others = $derived(data?.sessions.filter((s) => !s.current) ?? []);

	const herdrRows = $derived.by((): Row[] => {
		const rows: Row[] = [];
		if (current?.running) {
			rows.push({ key: 'reload', action: 'reload-config', label: 'Reload config', confirm: false });
			rows.push({
				key: 'restart',
				action: 'restart-server',
				label: 'Restart herdr',
				hint: 'live handoff, agents keep running',
				confirm: true
			});
			rows.push({
				key: 'stop',
				action: 'stop-server',
				label: 'Stop herdr server',
				hint: 'agents resume on start',
				confirm: true,
				danger: true
			});
		} else if (current) {
			rows.push({
				key: 'start',
				action: 'start-server',
				label: 'Start herdr server',
				confirm: false
			});
		}
		rows.push({
			key: 'update-all',
			action: 'update-all',
			label: 'Update everything',
			hint: 'stop, update herdr + harnesses, start',
			confirm: true,
			danger: true
		});
		rows.push({
			key: 'update',
			action: 'update-herdr',
			label: 'Update herdr',
			hint: 'then restart to apply',
			confirm: true
		});
		return rows;
	});

	function sessionRow(s: Session): Row {
		return s.running
			? {
					key: `stop:${s.name}`,
					action: 'stop-session',
					name: s.name,
					label: 'Stop',
					confirm: true,
					danger: true
				}
			: {
					key: `delete:${s.name}`,
					action: 'delete-session',
					name: s.name,
					label: 'Delete',
					confirm: true,
					danger: true
				};
	}

	const commandRows = $derived(
		(data?.commands ?? []).map((c): Row => ({
			key: `run:${c.id}`,
			action: 'run',
			name: c.id,
			label: c.label,
			confirm: c.confirm
		}))
	);

	const EXAMPLE = `{
  "commands": [
    { "id": "update-claude", "label": "Update Claude Code", "argv": ["claude", "update"] },
    { "id": "update-harnesses", "label": "Update harnesses", "argv": ["mise", "upgrade"] },
    { "id": "disk", "label": "Disk space", "argv": ["df", "-h", "/"], "confirm": false }
  ]
}`;

	function ended(job: Job): string {
		if (!job.done) return 'running';
		return job.code === 0 ? 'done' : `failed (exit ${job.code ?? '?'})`;
	}

	onMount(() => {
		void refresh();
	});

	$effect(() => watchWide());

	let treeOpen = $state(false);
</script>

{#snippet action(row: Row)}
	{@const busy = posting === row.key || busyActions.has(jobKey(row))}
	{#if confirming === row.key}
		<div class="flex min-h-12 items-center gap-2 px-3.5">
			<span class="flex-1 text-[14px]">{row.label}?</span>
			<button
				class="min-h-9 rounded-full bg-chip px-3 text-[13px]"
				onclick={() => (confirming = null)}>Cancel</button
			>
			<button
				class="min-h-9 rounded-full px-3 text-[13px] font-medium text-card {row.danger
					? 'bg-blocked'
					: 'bg-ink'}"
				onclick={() => run(row)}>Yes, {row.label.toLowerCase()}</button
			>
		</div>
	{:else}
		<button
			class="flex min-h-12 w-full items-center gap-2 px-3.5 text-left text-[15px] disabled:opacity-60 {row.danger
				? 'text-blocked-ink'
				: ''}"
			disabled={busy}
			onclick={() => (row.confirm ? (confirming = row.key) : run(row))}
		>
			<span class="flex-1">{row.label}</span>
			{#if busy}
				<Spinner size={12} label="Running" />
			{:else if row.hint}
				<span class="font-mono text-[11px] text-faint">{row.hint}</span>
			{/if}
		</button>
	{/if}
{/snippet}

<div class="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
	{#snippet title()}
		<h1 class="truncate text-[17px] font-semibold">System</h1>
	{/snippet}

	<header class="shrink-0 border-b border-hairline">
		<AppHeader
			onmenu={() => (treeOpen = true)}
			menuLabel="Workspaces"
			menuExpanded={treeOpen}
			middle={title}
			backTo="/settings"
			backLabel="Back to settings"
		/>
	</header>

	<div class="flex w-full min-w-0 flex-1 lg:min-h-0">
		{#if screen.wide}
			<SettingsNav active="system" />
		{/if}
		<div class="flex min-w-0 flex-1 flex-col lg:min-h-0 lg:overflow-y-auto">
			<main
				class="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 pt-3 pb-24 lg:mx-0 lg:px-6 lg:pb-8"
			>
				{#if loadError}
					<p
						class="rounded-xl border border-hairline bg-card px-3.5 py-3 text-[13px] text-danger-ink"
					>
						{loadError}
					</p>
				{/if}
				{#if actionError}
					<p
						class="rounded-xl border border-hairline bg-card px-3.5 py-3 text-[13px] text-danger-ink"
					>
						{actionError}
					</p>
				{/if}

				<section>
					<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">herdr</h2>
					<div
						class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
					>
						<div class="flex items-center gap-2.5 px-3.5 py-3">
							<span
								class="h-2.5 w-2.5 shrink-0 rounded-full {current?.running
									? 'bg-done'
									: 'bg-blocked'}"
							></span>
							<span class="flex-1 text-[15px]">
								{#if current}
									session <span class="font-mono">{current.name}</span>
									{current.running ? 'running' : 'stopped'}
								{:else if data}
									bordr's session is not one herdr lists
								{:else}
									loading…
								{/if}
							</span>
						</div>
						{#if data && current}
							<p class="px-3.5 py-2.5 text-[12.5px] text-muted">
								{#if data.unit}
									runs as <span class="font-mono">{data.unit.unit}</span>
									({data.unit.scope} unit){data.unit.scope === 'system'
										? ' — start and stop need the polkit rule from the installer'
										: ''}
								{:else}
									no herdr unit installed — Start runs a one-off one, and nothing brings herdr back
									after a reboot
								{/if}
							</p>
						{/if}
						{#if data?.sessionsError}
							<p class="px-3.5 py-3 text-[12.5px] text-danger-ink">{data.sessionsError}</p>
						{/if}
						{#each herdrRows as row (row.key)}
							{@render action(row)}
						{/each}
					</div>
				</section>

				{#if data?.outdated.length}
					<section>
						<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">running an old version</h2>
						<div
							class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
						>
							{#each data.outdated as p (p.pid)}
								<div class="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px]">
									<span class="min-w-0 flex-1 truncate">
										<span class="font-medium">{p.tool}</span>
										<span class="font-mono text-muted">{p.version} → {p.latest}</span>
									</span>
									<span class="min-w-0 truncate font-mono text-[11.5px] text-faint"
										>{p.cwd.replace(/^\/home\/[^/]+/, '~')}</span
									>
								</div>
							{/each}
						</div>
						<p class="mt-1.5 px-1 text-[11.5px] text-faint">
							An update reaches new agents only. Restart these to pick it up.
						</p>
					</section>
				{/if}

				{#if others.length}
					<section>
						<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">other sessions</h2>
						<div
							class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
						>
							{#each others as s (s.name)}
								<div class="flex items-center gap-2.5 pl-3.5">
									<span class="h-2 w-2 shrink-0 rounded-full {s.running ? 'bg-done' : 'bg-faint'}"
									></span>
									<span class="min-w-0 flex-1 truncate font-mono text-[14px]">{s.name}</span>
									<span class="text-[12px] text-muted">{s.running ? 'running' : 'stopped'}</span>
									<div class="min-w-0 shrink-0">{@render action(sessionRow(s))}</div>
								</div>
							{/each}
						</div>
						<p class="mt-1.5 px-1 text-[11.5px] text-faint">
							bordr shows the agents of its own session only.
						</p>
					</section>
				{/if}

				<section>
					<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">commands</h2>
					{#if commandRows.length}
						<div
							class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
						>
							{#each commandRows as row (row.key)}
								{@render action(row)}
							{/each}
						</div>
					{/if}
					{#if data?.commandsError}
						<p
							class="mt-2 rounded-xl border border-hairline bg-card px-3.5 py-3 text-[12.5px] text-danger-ink"
						>
							<span class="font-mono">{data.commandsPath}</span>: {data.commandsError}
						</p>
					{:else if data && !commandRows.length}
						<div class="rounded-xl border border-hairline bg-card px-3.5 py-3 text-[13px]">
							<p>
								Harness updates and anything else you want a button for go in
								<span class="font-mono">{data.commandsPath}</span>. Edit it at a terminal on this
								host; the phone can only run what it lists. No shell: use
								<span class="font-mono">["sh", "-c", "…"]</span> if you need one.
							</p>
							<pre class="mt-2 overflow-x-auto font-mono text-[11.5px] text-muted">{EXAMPLE}</pre>
						</div>
					{/if}
				</section>

				{#if data?.jobs.length}
					<section>
						<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">recent runs</h2>
						<div class="space-y-2">
							{#each data.jobs as job, i (job.id)}
								<details
									class="overflow-hidden rounded-xl border border-hairline bg-card"
									open={i === 0}
								>
									<summary class="flex min-h-11 list-none items-center gap-2 px-3.5 py-2.5">
										<span class="flex-1 text-[14px]">{job.label}</span>
										{#if !job.done}<Spinner size={12} label="Running" />{/if}
										<span
											class="font-mono text-[11px] {job.done && job.code !== 0
												? 'text-danger-ink'
												: 'text-faint'}">{ended(job)}</span
										>
									</summary>
									<pre
										class="max-h-80 overflow-auto border-t border-hairline px-3.5 py-2.5 font-mono text-[11.5px] whitespace-pre-wrap">{job.output ||
											'(no output yet)'}</pre>
								</details>
							{/each}
						</div>
					</section>
				{/if}
			</main>
		</div>
	</div>

	{#if treeOpen}
		<div class="fixed inset-0 z-40">
			<button
				class="no-press absolute inset-0 bg-black/40"
				aria-hidden="true"
				tabindex="-1"
				onclick={() => (treeOpen = false)}
			></button>
			<div class="absolute inset-y-0 left-0 w-[86%] max-w-[320px] shadow-2xl">
				<SessionTree onclose={() => (treeOpen = false)} home backTo="/settings" />
			</div>
		</div>
	{/if}

	<TabBar />
</div>
