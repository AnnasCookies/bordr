<script lang="ts">
	import MessageBlocks from './message-blocks.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import type { Message } from '$lib/server/transcript/types';
	import type { SubagentSummary } from '$lib/server/transcript/subagents';

	/**
	 * A sub-agent's conversation, over the one that spawned it.
	 *
	 * A sheet rather than a route: you open a sub-agent to see what it found
	 * and then go back to what you were reading, and a route would put that on
	 * the phone's back stack between you and the transcript.
	 */
	let {
		pane,
		agent,
		onclose
	}: {
		pane: string;
		agent: SubagentSummary;
		onclose: () => void;
	} = $props();

	let messages = $state<Message[]>([]);
	let error = $state<string | null>(null);
	let loading = $state(true);

	/**
	 * Re-fetched whenever the agent changes, and polled while it is still
	 * writing — a running sub-agent is exactly the one worth watching, and it
	 * has no SSE of its own.
	 */
	$effect(() => {
		const id = agent.id;
		let stop = false;

		async function load() {
			try {
				const res = await fetch(
					`/api/agents/${encodeURIComponent(pane)}/subagents/${encodeURIComponent(id)}`
				);
				if (!res.ok) {
					error = `bordr returned ${res.status} for this sub-agent`;
					return;
				}
				const body = (await res.json()) as { messages: Message[] };
				if (stop) return;
				messages = body.messages ?? [];
				error = null;
			} catch {
				// Keep whatever is on screen; the connection indicator says why.
			} finally {
				if (!stop) loading = false;
			}
		}

		void load();
		const timer = setInterval(() => void load(), 4000);
		return () => {
			stop = true;
			clearInterval(timer);
		};
	});
</script>

<div class="fixed inset-0 z-40 flex flex-col">
	<!--
		Presentational, the same as the drawer scrims. The sheet's own "close" is
		the labelled way out, so naming this one as well put two buttons for one
		job in the accessibility tree; and a full-screen overlay that shrinks on
		press, as every real control does, is absurd.
	-->
	<button class="no-press flex-1 bg-black/40" aria-hidden="true" tabindex="-1" onclick={onclose}
	></button>

	<section
		class="flex max-h-[86%] min-h-0 flex-col rounded-t-2xl border-t border-hairline bg-page shadow-2xl"
	>
		<header class="flex shrink-0 items-start gap-2 border-b border-hairline px-3 py-2.5">
			<span class="min-w-0 flex-1">
				<span class="block truncate text-[15px] font-semibold">{agent.agentType}</span>
				{#if agent.description}
					<span class="block truncate text-[12px] text-muted">{agent.description}</span>
				{/if}
			</span>
			<button
				class="shrink-0 rounded-lg border border-edge px-2.5 py-1 font-mono text-[11px] text-muted"
				onclick={onclose}>close</button
			>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
			{#if error}
				<p class="text-[13px] text-danger-ink">{error}</p>
			{:else if loading && messages.length === 0}
				<p class="text-[13px] text-muted">Reading…</p>
			{:else if messages.length === 0}
				<p class="text-[13px] text-muted">This sub-agent has not written anything yet.</p>
			{:else}
				<div class="flex flex-col gap-3 text-[14.5px] leading-[1.5]">
					{#each messages as message, i (i)}
						<div class="flex gap-2">
							<span
								class="shrink-0 font-mono text-[13px] leading-[1.7] {message.role === 'user'
									? 'text-working'
									: 'text-faint'}"
								aria-hidden="true">{message.role === 'user' ? '›' : '·'}</span
							>
							<div class="min-w-0 flex-1">
								<MessageBlocks blocks={message.blocks ?? []} mono={prefs.value.monoSize} showWork />
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</section>
</div>
