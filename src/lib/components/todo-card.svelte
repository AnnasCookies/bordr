<script module lang="ts">
	import { SvelteSet } from 'svelte/reactivity';

	/** A transcript refresh rebuilds messages; keep cards the person opened open. */
	const openPlans = new SvelteSet<string>();
</script>

<script lang="ts">
	import type { TodoPlan, TodoStatus } from '$lib/todo-plan';

	let {
		plan,
		truncatedLines = 0,
		mono = 11
	}: { plan: TodoPlan; truncatedLines?: number; mono?: number } = $props();
	const key = $derived(JSON.stringify(plan));

	const percent = $derived(plan.total > 0 ? Math.round((plan.closed / plan.total) * 100) : 0);
	const remaining = $derived.by(() => {
		if (plan.open === 0 && plan.blocked === 0) {
			return plan.abandoned > 0 ? `${plan.completed} done · ${plan.abandoned} dropped` : 'done';
		}
		return [
			...(plan.open > 0 ? [`${plan.open} open`] : []),
			...(plan.blocked > 0 ? [`${plan.blocked} blocked`] : [])
		].join(' · ');
	});

	function toggle(event: MouseEvent) {
		event.preventDefault();
		if (openPlans.has(key)) openPlans.delete(key);
		else openPlans.add(key);
	}

	function statusLabel(status: TodoStatus): string {
		switch (status) {
			case 'completed':
				return 'Done';
			case 'in_progress':
				return 'In progress';
			case 'blocked':
				return 'Blocked';
			case 'abandoned':
				return 'Dropped';
			default:
				return 'Pending';
		}
	}
</script>

<details
	class="plan"
	class:finished={plan.closed === plan.total}
	class:blocked-plan={plan.blocked > 0}
	style="--mono: {mono}px"
	open={openPlans.has(key)}
>
	<summary onclick={toggle}>
		<span class="chevron" aria-hidden="true"></span>
		<span class="title">plan</span>
		{#if plan.activePhase}<span class="active">{plan.activePhase}</span>{/if}
		<span class:finished={plan.closed === plan.total} class:blocked={plan.blocked > 0} class="count"
			>{plan.closed}/{plan.total}</span
		>
		<span class="mini-rail" aria-hidden="true"><span style="width: {percent}%"></span></span>
	</summary>

	<div class="inside">
		<div class="progress-row">
			<div
				class="progress"
				role="progressbar"
				aria-label="Todo progress"
				aria-valuemin="0"
				aria-valuemax={Math.max(plan.total, 1)}
				aria-valuenow={plan.closed}
				aria-valuetext="{plan.closed} of {plan.total} tasks closed"
			>
				<span style="width: {percent}%"></span>
			</div>
			<span>{remaining}</span>
		</div>

		<!-- Snapshot prose is not a unique key. -->
		<!-- eslint-disable-next-line svelte/require-each-key -->
		{#each plan.phases as phase}
			<section class:current={phase.name === plan.activePhase}>
				<header>
					<span>{phase.name}</span>
					<span
						>{phase.items.filter(
							(item) => item.status === 'completed' || item.status === 'abandoned'
						).length}/{phase.items.length}</span
					>
				</header>
				<ul>
					<!-- eslint-disable-next-line svelte/require-each-key -->
					{#each phase.items as item}
						<li class={item.status}>
							<span class="mark" aria-hidden="true"></span>
							<span class="sr-only">{statusLabel(item.status)}: </span>
							<span class="task">{item.content}</span>
							{#if item.note}<span class="note">{item.note}</span>{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/each}

		{#if truncatedLines > 0}<p class="truncated">+{truncatedLines} more lines</p>{/if}
	</div>
</details>

<style>
	.plan {
		margin: 0.35em 0;
		overflow: hidden;
		border: 1px solid var(--hairline);
		border-radius: 10px;
		background: var(--card);
	}
	.plan:first-child {
		margin-top: 0;
	}
	.plan:last-child {
		margin-bottom: 0;
	}
	summary {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.5em;
		padding: 0.5em 0.65em;
		cursor: pointer;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.chevron {
		width: 0;
		height: 0;
		flex: none;
		border-top: 3px solid transparent;
		border-bottom: 3px solid transparent;
		border-left: 4px solid currentColor;
		opacity: 0.5;
		transition: transform 120ms ease;
	}
	details[open] .chevron {
		transform: rotate(90deg);
	}
	.title,
	.count,
	header,
	.progress-row,
	.truncated {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--mono);
	}
	.title {
		font-weight: 500;
	}
	.active {
		min-width: 0;
		overflow: hidden;
		flex: 1;
		font-size: 0.88em;
		white-space: nowrap;
		text-overflow: ellipsis;
		opacity: 0.72;
	}
	.count {
		flex: none;
		color: var(--working);
	}
	.count.finished {
		color: var(--done);
	}
	.count.blocked {
		color: var(--blocked);
	}
	.mini-rail {
		width: 2.75em;
		height: 3px;
		flex: none;
		overflow: hidden;
		border-radius: 999px;
		background: var(--idle-rail);
	}
	.mini-rail span,
	.progress span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--working);
	}
	.plan.finished .mini-rail span,
	.plan.finished .progress span {
		background: var(--done);
	}
	.plan.blocked-plan .mini-rail span,
	.plan.blocked-plan .progress span {
		background: var(--blocked);
	}
	.inside {
		padding: 0 0.65em 0.65em;
	}
	.progress-row {
		display: flex;
		align-items: center;
		gap: 0.65em;
		margin-bottom: 0.55em;
		color: var(--muted);
	}
	.progress {
		height: 5px;
		min-width: 0;
		flex: 1;
		overflow: hidden;
		border-radius: 999px;
		background: var(--idle-rail);
	}
	section {
		border-left: 2px solid var(--idle-rail);
		padding: 0.1em 0 0.15em 0.65em;
	}
	section + section {
		margin-top: 0.55em;
	}
	section.current {
		border-left-color: var(--working);
	}
	header {
		display: flex;
		justify-content: space-between;
		gap: 0.75em;
		margin-bottom: 0.25em;
		color: var(--muted);
	}
	section.current header {
		color: var(--working);
	}
	ul {
		display: grid;
		gap: 0.25em;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: 0.8em minmax(0, 1fr);
		align-items: baseline;
		column-gap: 0.45em;
		font-size: 0.9em;
	}
	.mark {
		position: relative;
		top: 0.05em;
		width: 0.72em;
		height: 0.72em;
		border: 1.5px solid var(--idle-ink);
		border-radius: 50%;
	}
	.completed .mark {
		border-color: var(--done);
		background: var(--done);
	}
	.completed .mark::after {
		position: absolute;
		top: 0.08em;
		left: 0.2em;
		width: 0.2em;
		height: 0.36em;
		border-right: 1.5px solid var(--card);
		border-bottom: 1.5px solid var(--card);
		content: '';
		transform: rotate(45deg);
	}
	.in_progress .mark {
		border: 3px solid var(--working);
		background: var(--working-bg);
	}
	.blocked .mark {
		border-color: var(--blocked);
		background: var(--blocked);
	}
	.abandoned .mark {
		border-color: var(--danger);
	}
	.abandoned .mark::before,
	.abandoned .mark::after {
		position: absolute;
		top: 0.27em;
		left: 0.08em;
		width: 0.46em;
		height: 1.5px;
		background: var(--danger);
		content: '';
		transform: rotate(45deg);
	}
	.abandoned .mark::after {
		transform: rotate(-45deg);
	}
	.completed .task {
		text-decoration: line-through;
		opacity: 0.58;
	}
	.abandoned .task {
		color: var(--danger-ink);
		text-decoration: line-through;
		opacity: 0.72;
	}
	.in_progress .task {
		font-weight: 500;
	}
	.blocked .task {
		color: var(--blocked-ink);
	}
	.note {
		grid-column: 2;
		font-size: 0.82em;
		color: var(--blocked-ink);
	}
	.truncated {
		margin: 0.5em 0 0;
		color: var(--muted);
	}
	@media (prefers-reduced-motion: reduce) {
		.chevron {
			transition: none;
		}
	}
</style>
