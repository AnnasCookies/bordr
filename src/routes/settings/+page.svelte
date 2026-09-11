<script lang="ts">
	import {
		prefs,
		type GroupBy,
		type PreviewMode,
		type SortBy,
		type Theme
	} from '$lib/prefs.svelte';
	import SettingRow from '$lib/components/setting-row.svelte';
	import ToggleRow from '$lib/components/toggle-row.svelte';
	import ColourRow from '$lib/components/colour-row.svelte';
	import TabBar from '$lib/components/tab-bar.svelte';
	import Icon from '$lib/components/icon.svelte';
	import { checkPush, togglePushDetailed, type PushState } from '$lib/push-client';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import type { KeyStripMode } from '$lib/prefs.svelte';

	let pushState = $state<PushState>('unknown');
	let pushMessage = $state<string | null>(null);
	let testState = $state<'idle' | 'sending' | 'sent' | 'failed'>('idle');

	onMount(async () => {
		pushState = await checkPush();
	});

	async function onTogglePush() {
		const { state, message } = await togglePushDetailed(pushState);
		pushState = state;
		pushMessage = message;
	}

	async function sendTest() {
		testState = 'sending';
		try {
			const r = await fetch('/api/push/test', { method: 'POST' });
			testState = r.ok ? 'sent' : 'failed';
		} catch {
			testState = 'failed';
		}
		setTimeout(() => (testState = 'idle'), 4000);
	}
</script>

<div class="flex min-h-dvh flex-col">
	<header class="px-4 pt-4 pb-3">
		<h1 class="text-[30px] font-semibold tracking-[-0.6px]">Settings</h1>
	</header>

	<main class="flex-1 space-y-5 px-4 pb-24">
		<section>
			<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">agents list</h2>
			<div
				class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
			>
				<SettingRow
					label="Group by"
					value={prefs.value.groupBy}
					options={[
						{ v: 'workspace' as GroupBy, l: 'Workspace' },
						{ v: 'status' as GroupBy, l: 'Status' },
						{ v: 'harness' as GroupBy, l: 'Harness' },
						{ v: 'none' as GroupBy, l: 'None' }
					]}
					onchange={(v) => prefs.set('groupBy', v)}
				/>
				<SettingRow
					label="Sort within group"
					value={prefs.value.sort}
					options={[
						{ v: 'status-title' as SortBy, l: 'Status' },
						{ v: 'title' as SortBy, l: 'Title' },
						{ v: 'recent' as SortBy, l: 'Recent' }
					]}
					onchange={(v) => prefs.set('sort', v)}
				/>
				<ToggleRow
					label="Show rollup counts"
					checked={prefs.value.rollup}
					onchange={(v) => prefs.set('rollup', v)}
				/>
				<SettingRow
					label="Preview line"
					value={prefs.value.preview}
					options={[
						{ v: 'activity' as PreviewMode, l: 'Activity' },
						{ v: 'cwd' as PreviewMode, l: 'cwd' },
						{ v: 'none' as PreviewMode, l: 'None' }
					]}
					onchange={(v) => prefs.set('preview', v)}
				/>
			</div>
		</section>

		<section>
			<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">appearance</h2>
			<div
				class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
			>
				<SettingRow
					label="Theme"
					value={prefs.value.theme}
					options={[
						{ v: 'light' as Theme, l: 'Light' },
						{ v: 'dark' as Theme, l: 'Dark' },
						{ v: 'system' as Theme, l: 'System' }
					]}
					onchange={(v) => prefs.set('theme', v)}
				/>
				<SettingRow
					label="Mono size in peek & tool rows"
					value={String(prefs.value.monoSize)}
					options={[
						{ v: '10', l: '10' },
						{ v: '11', l: '11' },
						{ v: '12', l: '12' },
						{ v: '13', l: '13' }
					]}
					onchange={(v) => prefs.set('monoSize', Number(v))}
				/>
			</div>
		</section>

		<section>
			<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">input</h2>
			<div
				class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
			>
				<SettingRow
					label="Manual controls"
					value={prefs.value.keyStrip}
					options={[
						{ v: 'always' as KeyStripMode, l: 'Open' },
						{ v: 'peek' as KeyStripMode, l: 'On demand' }
					]}
					onchange={(v) => prefs.set('keyStrip', v)}
				/>
				<ToggleRow
					label="Colour bubbles by harness"
					hint="Tint the agent bubble with that harness's own accent, so claude and codex are told apart at a glance. A colour picked below always wins."
					checked={prefs.value.harnessBubbles}
					onchange={(v) => prefs.set('harnessBubbles', v)}
				/>
				<ToggleRow
					label="Show the work"
					hint="Tool calls, their results and the agent's thinking, as expandable rows in every conversation. Each conversation's own toggle overrides this and is remembered."
					checked={prefs.value.showWork}
					onchange={(v) => prefs.set('showWork', v)}
				/>
				<ToggleRow
					label="Swipe to cycle agents"
					hint="Swipe across a conversation for the next or previous agent in the list. Swiping from either screen edge still goes back."
					checked={prefs.value.swipeAgents}
					onchange={(v) => prefs.set('swipeAgents', v)}
				/>
				<ToggleRow
					label="Enter sends"
					hint={prefs.value.enterSends
						? 'Shift+Enter makes a newline.'
						: 'Enter makes a newline; ⌘/Ctrl+Enter sends.'}
					checked={prefs.value.enterSends}
					onchange={(v) => prefs.set('enterSends', v)}
				/>
				<ToggleRow
					label="Dictate until you tap stop"
					hint={prefs.value.dictationHold
						? 'The engine gives up on every pause; bordr starts it again and keeps appending, so speak as slowly as you like.'
						: 'Stops at the first pause. Quick for a one-line reply.'}
					checked={prefs.value.dictationHold}
					onchange={(v) => prefs.set('dictationHold', v)}
				/>
				<label class="block px-3.5 py-3">
					<span class="mb-2 block text-[15px]">Dictation language</span>
					<input
						value={prefs.value.dictationLang}
						onchange={(e) =>
							prefs.set('dictationLang', (e.currentTarget as HTMLInputElement).value)}
						placeholder="en-GB"
						class="w-full rounded-lg border border-edge bg-page px-3 py-2 font-mono text-[13px]"
					/>
					<span class="mt-1.5 block text-[12px] text-muted">Web Speech · BCP-47 tag.</span>
				</label>
			</div>
		</section>

		<section>
			<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">messages</h2>
			<div
				class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
			>
				<ToggleRow
					label="Chat bubbles"
					hint="Off uses the prefixed transcript: › you, · the agent."
					checked={prefs.value.bubbles}
					onchange={(v) => prefs.set('bubbles', v)}
				/>
				{#if prefs.value.bubbles}
					<ColourRow
						label="You"
						background={prefs.bubbleColours.userBubble}
						text={prefs.bubbleColours.userText}
						onbackground={(v) => prefs.setBubble('user', v)}
						ontext={(v) => prefs.set('userText', v)}
					/>
					<ColourRow
						label="Agent"
						background={prefs.bubbleColours.agentBubble}
						text={prefs.bubbleColours.agentText}
						onbackground={(v) => prefs.setBubble('agent', v)}
						ontext={(v) => prefs.set('agentText', v)}
					/>
					<button
						class="w-full px-3.5 py-3 text-left text-[15px] text-working"
						onclick={() => prefs.reset('userBubble', 'userText', 'agentBubble', 'agentText')}
					>
						Reset colours
					</button>
				{/if}
			</div>
		</section>

		<section>
			<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">notifications</h2>
			<div
				class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
			>
				{#if pushState === 'unsupported'}
					<p class="px-3.5 py-3 text-[13px] text-muted">
						This browser has no Push API. Add bordr to your home screen over HTTPS to enable it.
					</p>
				{:else}
					<ToggleRow
						label="Push on this device"
						hint={pushState === 'unknown' ? 'Checking…' : undefined}
						checked={pushState === 'on'}
						onchange={onTogglePush}
					/>
					<button
						class="flex min-h-11 w-full items-center gap-3 px-3.5 py-3 text-left disabled:opacity-50"
						disabled={pushState !== 'on' || testState === 'sending'}
						onclick={sendTest}
					>
						<span class="flex-1 text-[15px]">Send a test notification</span>
						<span class="shrink-0 text-[13px] text-muted">
							{testState === 'sending'
								? 'Sending…'
								: testState === 'sent'
									? 'Sent'
									: testState === 'failed'
										? 'Failed'
										: ''}
						</span>
					</button>
				{/if}
				{#if pushMessage}
					<p class="px-3.5 py-3 text-[12.5px] text-danger-ink">{pushMessage}</p>
				{/if}
			</div>
		</section>

		<section>
			<div class="overflow-hidden rounded-xl border border-hairline bg-card">
				<a
					href={resolve('/settings/connection')}
					class="flex min-h-11 items-center gap-3 px-3.5 py-3"
				>
					<span class="flex-1 text-[15px]">Connection</span>
					<span class="shrink-0 text-faint"><Icon name="arrow-up-right" size={16} /></span>
				</a>
			</div>
		</section>
	</main>

	<TabBar />
</div>
