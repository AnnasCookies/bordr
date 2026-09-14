<script lang="ts">
	import { resolve } from '$app/paths';
	import { agentTitle, collapseHome } from '$lib/grouping';
	import { harnessText, STATUS_INK, STATUS_RAIL, UNKNOWN_RAIL } from '$lib/theme';
	import { prefs } from '$lib/prefs.svelte';
	import HarnessMark from './harness-mark.svelte';
	import PreviewText from './preview-text.svelte';
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
				{agentTitle(agent.title, agent.workspaceLabel, agent.paneId, agent.agent)}
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
		<!--
			The branch shares the preview's line rather than taking one of its
			own. A line per row is sixteen lines of scrolling on this fleet, to
			say something that is usually four characters long.

			Same arrangement as the conversation header: the preview truncates
			and the branch holds its width, because the preview is already
			clipped to 80 characters and reads fine cut short, while a branch cut
			short tells you nothing. The 40% cap stops a long branch name from
			doing to the preview what it is being protected from.
		-->
		<span class="mt-[3px] flex items-baseline gap-x-1.5 font-mono text-[11px] text-muted">
			<span class="min-w-0 flex-1 truncate">
				<span class={harnessText(agent.agent)}
					><HarnessMark agent={agent.agent} />
					{agent.agent}</span
				>
				· {#if preview}<PreviewText text={preview} />{:else}{collapseHome(agent.cwd)}{/if}
			</span>
			{#if prefs.value.showBranches && agent.branch}
				<span class="flex max-w-[40%] shrink-0 items-baseline gap-x-1">
					<span class="min-w-0 truncate text-branch">&#xe0a0; {agent.branch}</span>
					<!-- Never truncated: a half-shown ↑1 would read as ↑ nothing. -->
					{#if agent.ahead}<span class="shrink-0 text-ahead">&uarr;{agent.ahead}</span>{/if}
					{#if agent.behind}<span class="shrink-0 text-behind">&darr;{agent.behind}</span>{/if}
				</span>
			{/if}
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
