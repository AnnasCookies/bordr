<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { agentStore } from '$lib/agents.svelte';
	import { harnessText, STATUS_RAIL, UNKNOWN_RAIL } from '$lib/theme';
	import TabBar from '$lib/components/tab-bar.svelte';

	const store = agentStore;
	onMount(() => {
		store.start();
		return () => store.stop();
	});

	interface Hit {
		paneId: string;
		title: string;
		agent: string;
		role: string;
		snippet: string;
	}

	let q = $state('');
	let searching = $state(false);
	let truncated = $state(false);
	let hits = $state<Hit[]>([]);
	/** A failed search is not "no matches"; say what went wrong instead. */
	let searchError = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	/** Chips rather than typed `role:` syntax — this is driven with a thumb. */
	let role = $state<'' | 'user' | 'assistant'>('');
	let harness = $state('');

	const harnesses = $derived([...new Set(store.agents.map((a) => a.agent))].sort());
	/** Status per pane, so a hit's rail matches the row it links to. */
	const statusOf = $derived(
		Object.fromEntries(store.agents.map((a) => [a.paneId, a.status]))
	) as Record<string, string>;

	function run(delay = 300) {
		clearTimeout(timer);
		timer = setTimeout(async () => {
			const term = q.trim();
			if (term.length < 2) {
				hits = [];
				truncated = false;
				return;
			}
			searching = true;
			searchError = null;
			try {
				const params = [`q=${encodeURIComponent(term)}`];
				if (role) params.push(`role=${role}`);
				if (harness) params.push(`agent=${encodeURIComponent(harness)}`);
				const response = await fetch(`/api/search?${params.join('&')}`);
				const body = (await response.json().catch(() => null)) as {
					hits?: Hit[];
					truncated?: boolean;
					message?: string;
				} | null;
				if (!response.ok) throw new Error(body?.message ?? `search failed: ${response.status}`);
				hits = body?.hits ?? [];
				truncated = body?.truncated === true;
			} catch (e) {
				hits = [];
				truncated = false;
				searchError = `Search failed: ${(e as Error).message}.`;
			}
			searching = false;
		}, delay);
	}

	/** Chip taps re-search at once; the debounce exists for typing. */
	function setFilter(next: Partial<{ role: '' | 'user' | 'assistant'; harness: string }>) {
		if (next.role !== undefined) role = next.role;
		if (next.harness !== undefined) harness = next.harness;
		run(0);
	}

	/**
	 * Split a snippet around the search terms so matches can be marked without
	 * ever putting server text through `{@html}`.
	 */
	function marks(snippet: string): Array<{ text: string; hit: boolean }> {
		const needles = (q.toLowerCase().match(/-?"[^"]*"|\S+/g) ?? [])
			.filter((t) => !t.startsWith('-'))
			.map((t) => t.replaceAll('"', '').trim())
			.filter((t) => t.length >= 2);
		if (needles.length === 0) return [{ text: snippet, hit: false }];
		const lower = snippet.toLowerCase();
		const spans: Array<{ text: string; hit: boolean }> = [];
		let at = 0;
		while (at < snippet.length) {
			let best = -1;
			let width = 0;
			for (const needle of needles) {
				const found = lower.indexOf(needle, at);
				if (found !== -1 && (best === -1 || found < best)) {
					best = found;
					width = needle.length;
				}
			}
			if (best === -1) {
				spans.push({ text: snippet.slice(at), hit: false });
				break;
			}
			if (best > at) spans.push({ text: snippet.slice(at, best), hit: false });
			spans.push({ text: snippet.slice(best, best + width), hit: true });
			at = best + width;
		}
		return spans;
	}

	const HINT = '"phrase" -exclude';
</script>

<div class="flex min-h-dvh flex-col">
	<div class="flex items-center gap-3 px-4 pt-3 pb-2">
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:value={q}
			oninput={() => run()}
			autofocus
			placeholder="Search all sessions…"
			class="min-w-0 flex-1 rounded-xl border border-edge bg-card px-3 py-2.5 text-[16px] placeholder:text-faint"
		/>
		<a href={resolve('/')} class="shrink-0 text-[15px] text-working">Cancel</a>
	</div>
	<p class="px-4 pb-2 font-mono text-[11px] text-faint">{HINT}</p>

	<div class="flex flex-wrap gap-1.5 px-4 pb-3">
		{#each [{ v: '', l: 'Anyone' }, { v: 'user', l: 'Me' }, { v: 'assistant', l: 'Agent' }] as o (o.v)}
			<button
				class="rounded-full px-2.5 py-1.5 text-xs {role === o.v
					? 'bg-ink text-card'
					: 'bg-chip text-muted'}"
				onclick={() => setFilter({ role: o.v as '' | 'user' | 'assistant' })}
			>
				{o.l}
			</button>
		{/each}
		{#if harnesses.length > 1}
			<span class="mx-0.5 w-px self-stretch bg-hairline"></span>
			{#each harnesses as h (h)}
				<button
					class="rounded-full border px-2.5 py-1.5 text-xs {harness === h
						? `bg-card ${harnessText(h)} border-current`
						: 'border-transparent bg-chip text-muted'}"
					onclick={() => setFilter({ harness: harness === h ? '' : h })}
				>
					{h}
				</button>
			{/each}
		{/if}
	</div>

	<main class="flex-1 px-4 pb-24">
		{#if q.trim().length >= 2}
			{#if truncated}
				<p class="pb-2 text-[11.5px] text-muted">
					Showing the first matches per session — narrow the search for more.
				</p>
			{/if}
			<ul class="flex flex-col gap-1.5">
				{#each hits as hit, i (i)}
					<li>
						<a
							href={resolve('/a/[pane]', { pane: hit.paneId })}
							class="flex overflow-hidden rounded-xl border border-hairline bg-card"
						>
							<span
								class="w-1 shrink-0 self-stretch {STATUS_RAIL[statusOf[hit.paneId]] ?? ''}"
								style={statusOf[hit.paneId] === 'unknown' || !statusOf[hit.paneId]
									? `background:${UNKNOWN_RAIL}`
									: undefined}
							></span>
							<span class="min-w-0 flex-1 px-3 py-[11px]">
								<span class="block truncate font-mono text-[10.5px] text-muted">
									<span class={harnessText(hit.agent)}>{hit.agent}</span> · {hit.title} · {hit.role}
								</span>
								<span class="mt-1 block text-[14px] [overflow-wrap:anywhere] text-body">
									{#each marks(hit.snippet) as span, n (n)}{#if span.hit}<mark
												class="bg-mark text-ink">{span.text}</mark
											>{:else}{span.text}{/if}{/each}
								</span>
							</span>
						</a>
					</li>
				{:else}
					<li
						class="py-10 text-center text-[13px] {searchError ? 'text-danger-ink' : 'text-muted'}"
						role="status"
					>
						{searching ? 'Searching…' : (searchError ?? 'No matches in live sessions.')}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="py-10 text-center text-[13px] text-muted">
				Type at least two characters to search every live session.
			</p>
		{/if}
	</main>

	<TabBar />
</div>
