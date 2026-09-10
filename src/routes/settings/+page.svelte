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
	import type {
		HarnessAccent,
		StatusPosition,
		ToolDetail,
		WorkControl,
		KeyStripMode,
		PaneView
	} from '$lib/prefs.svelte';
	import MessageBlocks from '$lib/components/message-blocks.svelte';
	// Aliased: `ToolDetail` is already the name of the preference type.
	import ToolDetailView from '$lib/components/tool-detail.svelte';
	import { harnessBubble, harnessHex, harnessText } from '$lib/theme';
	import HarnessMark from '$lib/components/harness-mark.svelte';
	import CodeBlock from '$lib/components/code-block.svelte';
	import type { Block } from '$lib/server/transcript/types';

	/**
	 * The examples under each setting are rendered by the SAME components the
	 * conversation uses, from real block data. A hand-drawn mock would drift
	 * the first time the renderer changed; this cannot.
	 */
	const sampleInput = { command: 'bun run test:unit', description: 'Run the unit tests' };
	const sampleTool: Block[] = [
		{
			kind: 'tool',
			name: 'Bash',
			summary: 'Run the unit tests',
			input: sampleInput,
			result: { text: 'Tests  322 passed (322)', isError: false, truncatedLines: 0 },
			diff: null
		}
	];
	const sampleWork: Block[] = [{ kind: 'text', text: 'All 322 passed.' }, ...sampleTool];

	const sampleEdge = $derived(
		prefs.value.harnessAccent === 'edge' && !prefs.value.agentBubble
			? harnessHex('claude', prefs.resolvedTheme === 'dark')
			: ''
	);
	const sampleBubble = $derived(
		prefs.value.harnessAccent === 'tint' && !prefs.value.agentBubble
			? harnessBubble('claude', prefs.resolvedTheme === 'dark', prefs.bubbleColours.agentBubble)
			: prefs.bubbleColours.agentBubble
	);

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

<!--
	Live examples. Every one reads the real preference and renders with the
	real component where there is one, so a preview cannot drift from the
	thing it is previewing — the failure mode of a hand-drawn mock.
-->
{#snippet bubblePreview()}
	<div class="rounded-lg bg-page p-2">
		{#if prefs.value.bubbles}
			<div class="mb-1 flex justify-end">
				<span
					class="max-w-[80%] rounded-2xl rounded-br-sm px-2.5 py-1.5 text-[12.5px]"
					style="background:{prefs.bubbleColours.userBubble}; color:{prefs.bubbleColours.userText}"
					>run the tests</span
				>
			</div>
			<div class="flex">
				<span
					class="max-w-[80%] rounded-2xl rounded-bl-sm px-2.5 py-1.5 text-[12.5px]"
					style="background:{sampleBubble}; color:{prefs.bubbleColours.agentText}{sampleEdge
						? `; border-left:3px solid ${sampleEdge}`
						: ''}">All 322 passed.</span
				>
			</div>
		{:else}
			<p class="text-[12.5px]">
				<span class="font-mono text-working">›</span> run the tests
			</p>
			<p class="text-[12.5px]">
				<span class="font-mono {harnessText('claude')}">·</span> All 322 passed.
			</p>
		{/if}
	</div>
{/snippet}

{#snippet accentPreview()}
	<div class="flex gap-1.5 rounded-lg bg-page p-2">
		{#each ['claude', 'codex', 'pi'] as kind (kind)}
			<span
				class="flex-1 rounded-lg rounded-bl-sm px-2 py-1.5 text-center font-mono text-[11px]"
				style="background:{prefs.value.harnessAccent === 'tint'
					? harnessBubble(kind, prefs.resolvedTheme === 'dark', prefs.bubbleColours.agentBubble)
					: prefs.bubbleColours.agentBubble}; color:{prefs.bubbleColours.agentText}{prefs.value
					.harnessAccent === 'edge'
					? `; border-left:3px solid ${harnessHex(kind, prefs.resolvedTheme === 'dark')}`
					: ''}">{kind}</span
			>
		{/each}
	</div>
{/snippet}

{#snippet workPreview()}
	<div class="rounded-lg bg-page p-2">
		<MessageBlocks
			blocks={sampleWork}
			mono={prefs.value.monoSize}
			showWork={prefs.value.showWork}
		/>
		{#if !prefs.value.showWork}
			<p class="text-[12px] text-muted">Tool calls hidden; the agent's prose still shows.</p>
		{/if}
	</div>
{/snippet}

{#snippet activityPreview()}
	<div class="rounded-lg bg-page p-2">
		{#if prefs.value.showActivity}
			<div class="flex items-center gap-1.5 font-mono text-[11px] text-muted">
				<span class="h-1 w-1 rounded-full bg-working"></span>
				<span>Channeling… (4m 36s · ↓ 6.5k tokens)</span>
			</div>
			<p class="mt-0.5 text-[11px] text-faint">Tip: Use /btw to ask a quick side question</p>
		{:else}
			<div class="flex items-center gap-1.5 font-mono text-[11px] text-muted">
				<span class="h-1 w-1 rounded-full bg-working"></span> working
			</div>
		{/if}
	</div>
{/snippet}

{#snippet iconPreview()}
	<div class="flex gap-3 rounded-lg bg-page p-2 font-mono text-[12px]">
		{#each ['claude', 'gemini', 'codex', ''] as kind (kind)}
			<span class={harnessText(kind)}>
				{#if prefs.value.harnessIcons}<HarnessMark agent={kind} />{/if}
				{kind || 'shell'}
			</span>
		{/each}
	</div>
{/snippet}

{#snippet syntaxPreview()}
	<div class="rounded-lg bg-page p-2">
		<CodeBlock
			code={'const greeting = `Hello, ${name.trim()}!`;'}
			lang="typescript"
			mono={prefs.value.monoSize}
		/>
	</div>
{/snippet}

{#snippet suggestionPreview()}
	<div class="rounded-lg bg-page p-2">
		{#if prefs.value.showSuggestions}
			<div
				class="flex items-center gap-2 rounded-xl border border-hairline bg-card px-3 py-2 text-[13px]"
			>
				<span class="text-faint" aria-hidden="true">&rarr;</span>
				<span class="truncate text-muted">yeah commit and push both</span>
			</div>
		{:else}
			<p class="text-[12px] text-muted">The harness's own suggested prompt stays hidden.</p>
		{/if}
	</div>
{/snippet}

{#snippet statusPositionPreview()}
	<div class="rounded-lg bg-page p-2 text-[11px] text-muted">
		{#if prefs.value.statusPosition === 'header'}
			Under the title, where it is always visible.
		{:else}
			Under the composer — the on-screen keyboard covers it instead of the conversation.
		{/if}
		<p class="mt-1 truncate font-mono text-[10px] text-faint">
			CTX ▰▰▰▰▱▱▱▱▱▱ 48% · 478.9K/1.0M · scroll to pick a row
		</p>
	</div>
{/snippet}

{#snippet workControlPreview()}
	<div class="rounded-lg bg-page p-2">
		{#if prefs.value.workControl === 'header'}
			<span class="rounded-full bg-working-bg px-2.5 py-1 text-[12px] text-working">work 27</span>
			<span class="ml-1 text-[11px] text-muted">in the header, always reachable</span>
		{:else}
			<span class="text-[11.5px] text-working">Hide the work (27)</span>
			<span class="ml-1 text-[11px] text-muted">at the end of the transcript</span>
		{/if}
	</div>
{/snippet}

{#snippet toolPreview()}
	<!-- The detail directly, not the accordion around it: the whole point of
	     this setting is what is INSIDE the row, and a collapsed row shows
	     nothing either way. -->
	<div class="rounded-lg bg-page p-2">
		<p class="mb-1 font-mono text-[11px] text-muted">Bash · Run the unit tests</p>
		<ToolDetailView name="Bash" input={sampleInput} mono={prefs.value.monoSize} />
	</div>
{/snippet}

{#snippet monoPreview()}
	<div class="rounded-lg bg-page p-2">
		<ToolDetailView name="Bash" input={sampleInput} mono={prefs.value.monoSize} />
	</div>
{/snippet}

{#snippet stripPreview()}
	<div class="rounded-lg bg-page p-2 text-[12px] text-muted">
		{#if prefs.value.keyStrip === 'always'}
			Every conversation opens with the terminal peek and the key strip below it.
		{:else}
			Hidden until you tap ⌨ — the conversation starts as chat only.
		{/if}
		<div class="mt-1.5 flex gap-1">
			{#each ['esc', 'tab', '↑', '↓', '⏎'] as key (key)}
				<span class="rounded-md bg-chip px-2 py-1 font-mono text-[11px]">{key}</span>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet groupPreview()}
	<div class="rounded-lg bg-page p-2 text-[12px]">
		{#if prefs.value.groupBy === 'none'}
			<p class="text-muted">One flat list, no headings.</p>
		{:else}
			{@const heads =
				prefs.value.groupBy === 'workspace'
					? ['bordr', 'it-work']
					: prefs.value.groupBy === 'status'
						? ['blocked', 'working']
						: ['claude', 'codex']}
			{#each heads as head (head)}
				<p class="font-mono text-[10.5px] text-muted">{head}</p>
				<p class="mb-1 pl-2 text-ink">a session in that group</p>
			{/each}
		{/if}
	</div>
{/snippet}

{#snippet sortPreview()}
	<div class="rounded-lg bg-page p-2 font-mono text-[11px]">
		{#each prefs.value.sort === 'title' ? ['Alpha task', 'Beta task', 'Gamma task'] : prefs.value.sort === 'recent' ? ['just now', '4m ago', '2h ago'] : ['● blocked', '● working', '● idle'] as row (row)}
			<div class="text-muted">{row}</div>
		{/each}
	</div>
{/snippet}

{#snippet rollupPreview()}
	<div class="rounded-lg bg-page p-2">
		<p class="font-mono text-[10.5px] text-muted">
			bordr {#if prefs.value.rollup}<span class="text-faint">· 2 working · 1 idle</span>{/if}
		</p>
		<p class="pl-2 text-[12px]">Bordr exploration</p>
	</div>
{/snippet}

{#snippet previewLinePreview()}
	<div class="rounded-lg bg-page p-2 text-[12px]">
		<p class="font-medium">Bordr exploration</p>
		{#if prefs.value.preview === 'activity'}
			<p class="font-mono text-[11px] text-muted">Channeling… (4m 36s)</p>
		{:else if prefs.value.preview === 'cwd'}
			<p class="font-mono text-[11px] text-muted">~/bordr</p>
		{:else}
			<p class="text-[11px] text-faint">Nothing under the title.</p>
		{/if}
	</div>
{/snippet}

{#snippet themePreview()}
	<div class="flex gap-2 rounded-lg bg-page p-2">
		{#each [{ l: 'Light', bg: '#ffffff', ink: '#111827', edge: '#e5e7eb' }, { l: 'Dark', bg: '#0b0d10', ink: '#e5e7eb', edge: '#2a2f36' }] as swatch (swatch.l)}
			<span
				class="flex h-9 flex-1 items-center justify-center rounded-md border text-[11px]"
				style="background:{swatch.bg}; color:{swatch.ink}; border-color:{swatch.edge}"
				>{swatch.l}</span
			>
		{/each}
		<span class="self-center font-mono text-[10.5px] text-muted">
			{prefs.value.theme === 'system' ? 'follows the device' : `always ${prefs.value.theme}`}
		</span>
	</div>
{/snippet}

{#snippet swipePreview()}
	<div class="rounded-lg bg-page p-2 text-[12px] text-muted">
		{#if prefs.value.swipeAgents}
			<span class="font-mono">← swipe →</span> moves to the next agent in the list.
		{:else}
			A sideways swipe does nothing; use the list or the tree.
		{/if}
	</div>
{/snippet}

{#snippet enterPreview()}
	<div class="rounded-lg bg-page p-2 font-mono text-[11px] text-muted">
		{#if prefs.value.enterSends}
			<div>Enter — send</div>
			<div>Shift+Enter — new line</div>
		{:else}
			<div>Enter — new line</div>
			<div>Ctrl/Cmd+Enter — send</div>
		{/if}
	</div>
{/snippet}

{#snippet dictatePreview()}
	<div class="flex items-center gap-2 rounded-lg bg-page p-2 text-[12px] text-muted">
		<span class="h-2 w-2 rounded-full bg-blocked"></span>
		{#if prefs.value.dictationHold}
			Keeps listening until you tap stop.
		{:else}
			Stops on its own at the end of a sentence.
		{/if}
	</div>
{/snippet}

{#snippet photoPreview()}
	<div class="rounded-lg bg-page p-2">
		<div
			class="flex items-center justify-center rounded-lg border border-hairline bg-chip text-[11px] text-muted {prefs
				.value.compactImages
				? 'h-12'
				: 'h-24'}"
		>
			a photo, {prefs.value.compactImages ? 'cropped — tap to open' : 'full height'}
		</div>
	</div>
{/snippet}

{#snippet splitPreview()}
	<div class="rounded-lg bg-page p-2">
		{#if prefs.value.splitPanes}
			<div class="flex h-16 gap-[3px]">
				<div
					class="flex flex-[0.62] items-center justify-center rounded-md bg-card text-[10.5px] ring-1 ring-working/60 ring-inset"
				>
					this pane
				</div>
				<div class="flex flex-[0.38] flex-col gap-[3px]">
					<div
						class="term flex flex-1 items-center justify-center rounded-md bg-card text-[9px] text-muted"
					>
						screen
					</div>
					<div
						class="term flex flex-1 items-center justify-center rounded-md bg-card text-[9px] text-muted"
					>
						screen
					</div>
				</div>
			</div>
			<p class="mt-1 text-[11px] text-faint">
				Drag a divider to resize the split in the terminal too.
			</p>
		{:else}
			<div class="flex h-16 items-center justify-center rounded-md bg-card text-[10.5px]">
				one pane at a time
			</div>
			<p class="mt-1 text-[11px] text-faint">The tab's other panes stay a row of chips.</p>
		{/if}
	</div>
{/snippet}

{#snippet paneViewPreview()}
	<div class="rounded-lg bg-page p-2">
		{#if prefs.value.paneView === 'terminal'}
			<div class="term rounded-md bg-card p-1.5 text-[10.5px] leading-[1.4]">
				<div>
					<span class="text-done">tony@tm-work</span>:<span class="text-working">~</span>$ ls
				</div>
				<div class="text-muted">bordr&nbsp;&nbsp;repos&nbsp;&nbsp;obsidian</div>
				<div class="mt-1 flex items-center gap-1 border-t border-hairline pt-1">
					<span class="text-working">&rsaquo;</span>
					<span class="text-faint">type here, as you would in the pane</span>
					<span class="ml-auto text-faint">mic &middot; Ctrl+;</span>
				</div>
			</div>
			<p class="mt-1 text-[11px] text-faint">
				The screen itself, so a shell, a build or a picker looks exactly as it does on the machine.
			</p>
		{:else}
			<div class="rounded-md bg-card p-1.5">
				<p class="text-[12px]">Written and committed. Two commits, both pushed.</p>
				<p class="mt-1 rounded-lg border border-hairline px-2 py-1 text-[11px] text-faint">
					Type a reply…
				</p>
			</div>
			<p class="mt-1 text-[11px] text-faint">
				The transcript, rendered — bubbles, tools and diffs.
			</p>
		{/if}
	</div>
{/snippet}

{#snippet branchPreview()}
	<div class="rounded-lg bg-page p-2">
		<p class="text-[12.5px]">win-vm-omarchy</p>
		{#if prefs.value.showBranches}
			<p class="font-mono text-[10px] text-faint">&#xe0a0; master</p>
		{/if}
	</div>
{/snippet}

{#snippet tabLabelPreview()}
	<div class="flex gap-3 rounded-lg bg-page p-2 text-[12.5px]">
		<span class="border-b-2 border-working pb-0.5"
			>{prefs.value.smartTabLabels ? 'Bordr exploration' : 'tab 1'}</span
		>
		<span class="text-muted">{prefs.value.smartTabLabels ? '~/repos/it-work' : 'tab 2'}</span>
	</div>
{/snippet}

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
				>
					{#snippet preview()}{@render groupPreview()}{/snippet}
				</SettingRow>
				<SettingRow
					label="Sort within group"
					value={prefs.value.sort}
					options={[
						{ v: 'status-title' as SortBy, l: 'Status' },
						{ v: 'title' as SortBy, l: 'Title' },
						{ v: 'recent' as SortBy, l: 'Recent' }
					]}
					onchange={(v) => prefs.set('sort', v)}
				>
					{#snippet preview()}{@render sortPreview()}{/snippet}
				</SettingRow>
				<ToggleRow
					label="Show rollup counts"
					checked={prefs.value.rollup}
					onchange={(v) => prefs.set('rollup', v)}
				>
					{#snippet preview()}{@render rollupPreview()}{/snippet}
				</ToggleRow>
				<SettingRow
					label="Preview line"
					value={prefs.value.preview}
					options={[
						{ v: 'activity' as PreviewMode, l: 'Activity' },
						{ v: 'cwd' as PreviewMode, l: 'cwd' },
						{ v: 'none' as PreviewMode, l: 'None' }
					]}
					onchange={(v) => prefs.set('preview', v)}
				>
					{#snippet preview()}{@render previewLinePreview()}{/snippet}
				</SettingRow>
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
				>
					{#snippet preview()}{@render themePreview()}{/snippet}
				</SettingRow>
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
				>
					{#snippet preview()}{@render monoPreview()}{/snippet}
				</SettingRow>
			</div>
		</section>

		<section>
			<h2 class="mb-1.5 px-1 font-mono text-[10.5px] text-muted">workspaces &amp; panes</h2>
			<div
				class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
			>
				<ToggleRow
					label="Split panes"
					hint="Draw a tab as the split herdr actually has, with the pane you are in holding its transcript and composer. Desktop widths only."
					checked={prefs.value.splitPanes}
					onchange={(v) => prefs.set('splitPanes', v)}
				>
					{#snippet preview()}{@render splitPreview()}{/snippet}
				</ToggleRow>
				<SettingRow
					label="Pane view"
					value={prefs.value.paneView}
					options={[
						{ v: 'conversation' as PaneView, l: 'Conversation' },
						{ v: 'terminal' as PaneView, l: 'Terminal' }
					]}
					onchange={(v) => prefs.set('paneView', v)}
				>
					{#snippet preview()}{@render paneViewPreview()}{/snippet}
				</SettingRow>
				<ToggleRow
					label="Git branch in the tree"
					hint="Read from each workspace's directory; herdr does not serve it."
					checked={prefs.value.showBranches}
					onchange={(v) => prefs.set('showBranches', v)}
				>
					{#snippet preview()}{@render branchPreview()}{/snippet}
				</ToggleRow>
				<ToggleRow
					label="Name tabs after their contents"
					hint="herdr labels a tab with its own number until you rename it."
					checked={prefs.value.smartTabLabels}
					onchange={(v) => prefs.set('smartTabLabels', v)}
				>
					{#snippet preview()}{@render tabLabelPreview()}{/snippet}
				</ToggleRow>
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
				>
					{#snippet preview()}{@render stripPreview()}{/snippet}
				</SettingRow>
				<ToggleRow
					label="Suggested prompts"
					hint="The ghost prompt the harness offers in its own input box, as a tappable chip above the composer."
					checked={prefs.value.showSuggestions}
					onchange={(v) => prefs.set('showSuggestions', v)}
				>
					{#snippet preview()}{@render suggestionPreview()}{/snippet}
				</ToggleRow>
				<ToggleRow
					label="Swipe to cycle agents"
					hint="Swipe across a conversation for the next or previous agent in the list. Swiping from either screen edge still goes back."
					checked={prefs.value.swipeAgents}
					onchange={(v) => prefs.set('swipeAgents', v)}
				>
					{#snippet preview()}{@render swipePreview()}{/snippet}
				</ToggleRow>
				<ToggleRow
					label="Enter sends"
					hint={prefs.value.enterSends
						? 'Shift+Enter makes a newline.'
						: 'Enter makes a newline; ⌘/Ctrl+Enter sends.'}
					checked={prefs.value.enterSends}
					onchange={(v) => prefs.set('enterSends', v)}
				>
					{#snippet preview()}{@render enterPreview()}{/snippet}
				</ToggleRow>
				<ToggleRow
					label="Dictate until you tap stop"
					hint={prefs.value.dictationHold
						? 'The engine gives up on every pause; bordr starts it again and keeps appending, so speak as slowly as you like.'
						: 'Stops at the first pause. Quick for a one-line reply.'}
					checked={prefs.value.dictationHold}
					onchange={(v) => prefs.set('dictationHold', v)}
				>
					{#snippet preview()}{@render dictatePreview()}{/snippet}
				</ToggleRow>
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
				>
					{#snippet preview()}{@render bubblePreview()}{/snippet}
				</ToggleRow>
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
					<SettingRow
						label="Harness accent"
						value={prefs.value.harnessAccent}
						options={[
							{ v: 'edge' as HarnessAccent, l: 'Edge' },
							{ v: 'tint' as HarnessAccent, l: 'Tint' },
							{ v: 'off' as HarnessAccent, l: 'Off' }
						]}
						onchange={(v) => prefs.set('harnessAccent', v)}
					>
						{#snippet preview()}{@render accentPreview()}{/snippet}
					</SettingRow>
					<p class="px-3.5 pb-2 text-[12px] text-muted">
						Edge puts the harness's colour down the side of the bubble; tint blends it into the
						background. A colour picked above overrides both.
					</p>
					<button
						class="w-full px-3.5 py-3 text-left text-[15px] text-working"
						onclick={() => prefs.reset('userBubble', 'userText', 'agentBubble', 'agentText')}
					>
						Reset colours
					</button>
				{/if}
				<ToggleRow
					label="Show the work"
					hint="Tool calls, their results and the agent's thinking, as expandable rows. Each conversation's own toggle overrides this and is remembered."
					checked={prefs.value.showWork}
					onchange={(v) => prefs.set('showWork', v)}
				>
					{#snippet preview()}{@render workPreview()}{/snippet}
				</ToggleRow>
				<SettingRow
					label="Status lines"
					value={prefs.value.statusPosition}
					options={[
						{ v: 'header' as StatusPosition, l: 'Under title' },
						{ v: 'bottom' as StatusPosition, l: 'Below input' }
					]}
					onchange={(v) => prefs.set('statusPosition', v)}
				>
					{#snippet preview()}{@render statusPositionPreview()}{/snippet}
				</SettingRow>
				<SettingRow
					label="Show the work control"
					value={prefs.value.workControl}
					options={[
						{ v: 'inline' as WorkControl, l: 'In transcript' },
						{ v: 'header' as WorkControl, l: 'In header' }
					]}
					onchange={(v) => prefs.set('workControl', v)}
				>
					{#snippet preview()}{@render workControlPreview()}{/snippet}
				</SettingRow>
				<ToggleRow
					label="Activity line"
					hint="What the harness says it is doing while it works — its verb, elapsed time and tokens — instead of just 'working'."
					checked={prefs.value.showActivity}
					onchange={(v) => prefs.set('showActivity', v)}
				>
					{#snippet preview()}{@render activityPreview()}{/snippet}
				</ToggleRow>
				<ToggleRow
					label="Harness icons"
					hint="A glyph beside each harness name, in the list, the tree and the conversation header."
					checked={prefs.value.harnessIcons}
					onchange={(v) => prefs.set('harnessIcons', v)}
				>
					{#snippet preview()}{@render iconPreview()}{/snippet}
				</ToggleRow>
				<ToggleRow
					label="Syntax highlighting"
					hint="VS Code's own grammars and themes for code blocks, tool input and both sides of a diff. Off renders plain monospace and downloads nothing."
					checked={prefs.value.syntaxHighlight}
					onchange={(v) => prefs.set('syntaxHighlight', v)}
				>
					{#snippet preview()}{@render syntaxPreview()}{/snippet}
				</ToggleRow>
				<ToggleRow
					label="Collapse photos"
					hint="A photo shows as a strip until tapped. Off shows every image at full height."
					checked={prefs.value.compactImages}
					onchange={(v) => prefs.set('compactImages', v)}
				>
					{#snippet preview()}{@render photoPreview()}{/snippet}
				</ToggleRow>
				<SettingRow
					label="Tool calls"
					value={prefs.value.toolDetail}
					options={[
						{ v: 'formatted' as ToolDetail, l: 'Readable' },
						{ v: 'json' as ToolDetail, l: 'Raw JSON' }
					]}
					onchange={(v) => prefs.set('toolDetail', v)}
				>
					{#snippet preview()}{@render toolPreview()}{/snippet}
				</SettingRow>
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
