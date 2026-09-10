<script lang="ts">
	import { resolve } from '$app/paths';
	import { collapseHome } from '$lib/grouping';
	import { harnessText, STATUS_INK, STATUS_RAIL, UNKNOWN_RAIL } from '$lib/theme';
	import { prefs } from '$lib/prefs.svelte';
	import HarnessMark from './harness-mark.svelte';
	import type { ResolvedPathname } from '$app/types';
	import type { AgentSummary } from '$lib/types';

	let {
		agent,
		unread = false,
		preview,
		query = ''
	}: {
		agent: AgentSummary;
		unread?: boolean;
		preview: string;
		/** Appended to the link, so a share can travel to the conversation. */
		query?: string;
	} = $props();

	const dim = $derived(agent.status === 'idle' || agent.status === 'unknown');

	/**
	 * Which status row this harness settled on.
	 *
	 * The same index the conversation's status block remembers, so the list
	 * shows the row you already chose rather than a second choice to make.
	 */
	const statusRow = $derived.by(() => {
		const rows = agent.statusRows ?? [];
		if (rows.length === 0) return '';
		const chosen = prefs.value.statusLine[agent.agent] ?? 0;
		return rows[Math.min(Math.max(chosen, 0), rows.length - 1)];
	});
</script>

<a
	href={(resolve('/a/[pane]', { pane: agent.paneId }) + query) as ResolvedPathname}
	class="flex overflow-hidden rounded-xl border bg-card {agent.status === 'unknown'
		? 'border-dashed border-black/15 dark:border-white/15'
		: 'border-hairline'}"
>
	<span
		class="w-1 shrink-0 self-stretch {STATUS_RAIL[agent.status] ?? ''}"
		style={agent.status === 'unknown' ? `background:${UNKNOWN_RAIL}` : undefined}
	></span>
	<span class="min-w-0 flex-1 px-3 py-[11px]">
		<span class="flex items-baseline gap-2">
			<span class="min-w-0 flex-1 truncate text-[15px] font-medium {dim ? 'text-muted' : ''}">
				{agent.title || agent.paneId}
			</span>
			{#if unread}
				<span class="h-[7px] w-[7px] shrink-0 rounded-full bg-working" aria-label="unread"></span>
			{/if}
			{#if prefs.value.listDetail && agent.focused}
				<!-- herdr says which pane the terminal itself is on; it is the one
				     thing on the list you cannot work out from the row. -->
				<span
					class="shrink-0 rounded bg-chip px-1 font-mono text-[9.5px] text-faint"
					title="The terminal is looking at this pane">on screen</span
				>
			{/if}
			<span class="shrink-0 font-mono text-[10.5px] {STATUS_INK[agent.status] ?? 'text-faint'}">
				{agent.status}
			</span>
		</span>
		<span class="mt-[3px] block truncate font-mono text-[11px] text-muted">
			<span class={harnessText(agent.agent)}
				><HarnessMark agent={agent.agent} />
				{agent.agent}</span
			>
			· {preview || collapseHome(agent.cwd)}
		</span>
		{#if prefs.value.listDetail && statusRow}
			<!--
				The harness's own footer — model, context, spend — lifted off the
				screen reading the list already takes, so it costs no extra call.
				The row shown is the one this harness's status block settled on.
			-->
			<span class="mt-[3px] block truncate font-mono text-[10.5px] text-faint">{statusRow}</span>
		{/if}
		{#if agent.menu}
			<!-- A menu the person opened, not a blocked agent: the status stands,
			     the row says where to drive it. -->
			<span class="mt-[3px] block truncate font-mono text-[11px] text-blocked-ink">
				⌨ menu open on the terminal · {agent.menu}
			</span>
		{/if}
	</span>
</a>
