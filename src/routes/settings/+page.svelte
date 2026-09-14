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
	import AppHeader from '$lib/components/app-header.svelte';
	import SessionTree from '$lib/components/session-tree.svelte';
	import { screen, watchWide } from '$lib/wide.svelte';
	import SettingsNav from '$lib/components/settings-nav.svelte';
	import SettingsSection from '$lib/components/settings-section.svelte';
	import { SECTIONS } from '$lib/settings-sections';
	import { page } from '$app/state';
	import Icon from '$lib/components/icon.svelte';
	import { checkPush, togglePushDetailed, type PushState } from '$lib/push-client';
	import { onMount } from 'svelte';
	import { reduceMotion } from '$lib/motion';
	import { resolve } from '$app/paths';
	import type {
		BackTo,
		ClockFormat,
		MessageTime,
		SubagentStrip,
		DrawerHome,
		ChromeWhen,
		ConversationWidth,
		Motion,
		HeaderPull,
		HeaderModel,
		FillStyle,
		SoundAlerts,
		GradientEnd,
		StatusIndicators,
		HarnessAccent,
		StatusPosition,
		ToolDetail,
		WorkControl,
		KeyStripMode,
		PaneView,
		TerminalFit,
		TerminalDensity
	} from '$lib/prefs.svelte';
	import MessageBlocks from '$lib/components/message-blocks.svelte';
	import Bubble from '$lib/components/bubble.svelte';
	import BubbleMeta from '$lib/components/bubble-meta.svelte';
	import Ticks from '$lib/components/ticks.svelte';
	import Spinner from '$lib/components/spinner.svelte';
	import { clockTime } from '$lib/clock-time';
	// Aliased: `ToolDetail` is already the name of the preference type.
	import ToolDetailView from '$lib/components/tool-detail.svelte';
	import {
		harnessBubble,
		harnessHex,
		harnessText,
		STATUS_INK,
		STATUS_RAIL,
		STATUS_SYMBOL,
		STATUS_WORD
	} from '$lib/theme';
	import {
		bubbleInk,
		fillFar,
		fillWorstContrast,
		DEFAULT_FILL,
		DEFAULT_USER
	} from '$lib/bubble-colour';
	import HarnessMark from '$lib/components/harness-mark.svelte';
	import CodeBlock from '$lib/components/code-block.svelte';
	import type { Block } from '$lib/server/transcript/types';

	/**
	 * The examples under each setting are rendered by the SAME components the
	 * conversation uses, from real block data. A hand-drawn mock would drift
	 * the first time the renderer changed; this cannot.
	 */
	/** Fixed times, so a preview never changes under you while you read it. */
	const sampleAt = Date.UTC(2026, 0, 2, 9, 5);
	const sampleEvening = Date.UTC(2026, 0, 2, 17, 22);
	const sampleInput = { command: 'bun run test:unit', description: 'Run the unit tests' };
	const sampleTool: Block[] = [
		{
			kind: 'tool',
			name: 'Bash',
			summary: 'Run the unit tests',
			input: sampleInput,
			result: { text: 'Tests  322 passed (322)', isError: false, truncatedLines: 0 },
			diffs: []
		}
	];
	const sampleWork: Block[] = [{ kind: 'text', text: 'All 322 passed.' }, ...sampleTool];

	/**
	 * The swatch is the REAL bubble component, not a copy of it. The copy was
	 * the problem: it kept drawing a 3px left stripe for a while after the
	 * transcript had stopped, so the preview showed a look the app no longer
	 * had.
	 */
	const dark = $derived(prefs.resolvedTheme === 'dark');
	const accentMode = $derived(prefs.value.agentBubble ? 'off' : prefs.value.harnessAccent);

	const sampleAgentBorder = $derived(
		prefs.value.bubbleBorder
			? prefs.value.agentBorder ||
					(accentMode === 'off' ? 'var(--edge)' : harnessHex('claude', dark))
			: null
	);
	const sampleUserBorder = $derived(
		prefs.value.bubbleBorder
			? prefs.value.userBorder || (dark ? DEFAULT_USER.dark : DEFAULT_USER.light)
			: null
	);
	const sampleAgentFill = $derived(
		prefs.value.bubbleFill || accentMode === 'fill'
			? prefs.value.agentBubble ||
					(accentMode === 'fill'
						? harnessHex('claude', dark)
						: accentMode === 'tint'
							? harnessBubble('claude', dark, dark ? DEFAULT_FILL.dark : DEFAULT_FILL.light)
							: dark
								? DEFAULT_FILL.dark
								: DEFAULT_FILL.light)
			: null
	);
	const sampleUserFill = $derived(
		prefs.value.bubbleFill
			? prefs.value.userBubble || (dark ? DEFAULT_USER.dark : DEFAULT_USER.light)
			: null
	);
	const gradient = $derived(prefs.value.fillStyle === 'gradient');
	/** Same rule as the transcript: auto derives, harness borrows, custom picks. */
	function sampleEndFor(side: 'user' | 'agent'): string | null {
		if (prefs.value.fillStyle !== 'gradient') return null;
		const mode = prefs.value.gradientEnd;
		if (mode === 'custom')
			return (side === 'user' ? prefs.value.userGradientEnd : prefs.value.agentGradientEnd) || null;
		if (mode === 'harness' && side === 'agent') return harnessHex('claude', dark);
		return null;
	}
	const sampleAgentEnd = $derived(sampleEndFor('agent'));
	const sampleUserEnd = $derived(sampleEndFor('user'));

	/**
	 * The worst the text gets anywhere across either bubble.
	 *
	 * A picked gradient end is a choice this cannot solve — a pale fill fading
	 * into a dark harness colour has no single readable ink — so it is
	 * measured and reported rather than silently shipped half-unreadable.
	 */
	const gradientWorst = $derived(
		Math.min(
			sampleAgentFill ? fillWorstContrast(sampleAgentFill, dark, gradient, sampleAgentEnd) : 21,
			sampleUserFill ? fillWorstContrast(sampleUserFill, dark, gradient, sampleUserEnd) : 21
		)
	);

	const sampleAgentInk = $derived(
		!sampleAgentFill
			? 'var(--ink)'
			: prefs.value.agentText || bubbleInk(sampleAgentFill, dark, gradient, sampleAgentEnd)
	);

	/** The accent swatch renders three harnesses, so its fill resolves per kind. */
	function accentFillFor(kind: string): string | null {
		if (prefs.value.harnessAccent === 'fill') return harnessHex(kind, dark);
		if (prefs.value.harnessAccent === 'tint')
			return harnessBubble(kind, dark, dark ? DEFAULT_FILL.dark : DEFAULT_FILL.light);
		return prefs.value.bubbleFill ? (dark ? DEFAULT_FILL.dark : DEFAULT_FILL.light) : null;
	}
	const sampleUserInk = $derived(
		!sampleUserFill
			? 'var(--ink)'
			: prefs.value.userText || bubbleInk(sampleUserFill, dark, gradient)
	);

	/**
	 * Ready-made pairs, because four colour pickers is a fiddly way to choose
	 * a look on a phone. Each sets the fill AND the border for both sides, so
	 * a palette lands whichever of the two toggles happen to be on.
	 *
	 * Mid-tone values on purpose: one hex has to work on the light page and
	 * the dark one, so anything near either end of the range fails on a theme.
	 */
	const PALETTES: { name: string; user: string; agent: string }[] = [
		{ name: 'Ocean', user: '#0284c7', agent: '#0d9488' },
		{ name: 'Orchid', user: '#7c3aed', agent: '#db2777' },
		{ name: 'Grove', user: '#15803d', agent: '#b45309' },
		{ name: 'Ember', user: '#dc2626', agent: '#ea580c' },
		{ name: 'Slate', user: '#475569', agent: '#0f766e' }
	];

	function applyPalette(p: { user: string; agent: string }) {
		prefs.setBubble('user', p.user);
		prefs.setBubble('agent', p.agent);
		prefs.set('userBorder', p.user);
		prefs.set('agentBorder', p.agent);
	}

	/**
	 * Whether the install banner has been dismissed on this browser.
	 *
	 * Read straight from the key the banner writes rather than through `prefs`:
	 * it is a fact about this browser, not a preference, and it has no business
	 * in an exported settings object.
	 */
	const INSTALL_DISMISSED = 'bordr-install-dismissed';
	let installHidden = $state(false);

	function showInstall() {
		try {
			localStorage.removeItem(INSTALL_DISMISSED);
		} catch {
			// Storage blocked; the banner was never hidden in the first place.
		}
		installHidden = false;
	}

	let pushState = $state<PushState>('unknown');
	let pushMessage = $state<string | null>(null);
	let testState = $state<'idle' | 'sending' | 'sent' | 'failed'>('idle');
	/** Read on the client only: the server has no browser to ask. */
	let browserReduce = $state(false);

	onMount(async () => {
		browserReduce = reduceMotion();
		try {
			installHidden = Number(localStorage.getItem(INSTALL_DISMISSED)) > 0;
		} catch {
			installHidden = false;
		}
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

	let section = $derived(
		(page.url.searchParams.get('s') ?? 'agents list') as (typeof SECTIONS)[number]
	);

	$effect(() => watchWide());

	/** The workspaces drawer, so the app bar here reaches what it does elsewhere. */
	let treeOpen = $state(false);

	/**
	 * A phone shows every section, one after another, as it always has — a
	 * settings page you scroll is the familiar thing there, and a nav would
	 * cost a tap to reach anything.
	 *
	 * A desktop shows one, because the alternative is what it was doing: 5541
	 * pixels of scrolling in a 640px column stranded in the middle of a 1440px
	 * window, with no way to get to `notifications` except to travel past
	 * everything else.
	 *
	 * `connection` is the exception. It is a route of its own, and the nav
	 * sends a desktop straight there, so the card here that links to it would
	 * only ever be a link to the page you just asked for.
	 */
	function shown(key: string): boolean {
		if (!screen.wide) return true;
		return key !== 'connection' && section === key;
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
				<Bubble
					mine
					small
					border={sampleUserBorder}
					fill={sampleUserFill}
					fillGradient={gradient}
					fillEnd={sampleUserEnd}
					tail={prefs.value.bubbleTails}
					width={prefs.value.bubbleBorderWidth}
					ink={sampleUserInk}
					extra="max-w-[80%]">run the tests</Bubble
				>
			</div>
			<!-- Two agent turns, so the run rules show: the first keeps its top
			     corners, the second joins on and takes the tail. -->
			<div class="mb-0.5 flex">
				<Bubble
					small
					run="first"
					border={sampleAgentBorder}
					fill={sampleAgentFill}
					fillGradient={gradient}
					fillEnd={sampleAgentEnd}
					tail={prefs.value.bubbleTails}
					width={prefs.value.bubbleBorderWidth}
					ink={sampleAgentInk}
					extra="max-w-[80%]">Running them now.</Bubble
				>
			</div>
			<div class="flex">
				<Bubble
					small
					run="last"
					border={sampleAgentBorder}
					fill={sampleAgentFill}
					fillGradient={gradient}
					fillEnd={sampleAgentEnd}
					tail={prefs.value.bubbleTails}
					width={prefs.value.bubbleBorderWidth}
					ink={sampleAgentInk}
					extra="max-w-[80%]">All 322 passed.</Bubble
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
	<div class="flex gap-2 rounded-lg bg-page p-2 pb-3">
		{#each ['claude', 'codex', 'pi'] as kind (kind)}
			<span class="flex-1">
				<Bubble
					small
					border={prefs.value.harnessAccent === 'off' ? 'var(--edge)' : harnessHex(kind, dark)}
					fill={accentFillFor(kind)}
					fillGradient={gradient}
					width={prefs.value.bubbleBorderWidth}
					ink={accentFillFor(kind)
						? bubbleInk(accentFillFor(kind) as string, dark, gradient)
						: 'var(--ink)'}
					extra="block text-center font-mono !text-[11px]">{kind}</Bubble
				>
			</span>
		{/each}
	</div>
{/snippet}

{#snippet borderColours()}
	<div class="flex items-center gap-4 px-3.5 py-3">
		{#each [{ who: 'user' as const, label: 'You', key: 'userBorder' as const }, { who: 'agent' as const, label: 'Agent', key: 'agentBorder' as const }] as side (side.key)}
			<label class="flex flex-1 items-center gap-2 text-[13px] text-muted">
				<input
					type="color"
					value={prefs.value[side.key] ||
						(side.who === 'user'
							? dark
								? DEFAULT_USER.dark
								: DEFAULT_USER.light
							: harnessHex('claude', dark))}
					oninput={(e) => prefs.set(side.key, (e.currentTarget as HTMLInputElement).value)}
					class="h-8 w-10 shrink-0 rounded border border-edge bg-transparent"
					aria-label="{side.label} border colour"
				/>
				{side.label}
			</label>
		{/each}
	</div>
	<button
		class="w-full px-3.5 pb-2 text-left text-[12px] text-working"
		onclick={() => prefs.reset('userBorder', 'agentBorder')}
	>
		Use the harness colour
	</button>
{/snippet}

{#snippet indicatorPreview()}
	<div class="flex flex-col gap-1 rounded-lg bg-page p-2">
		{#each [{ s: 'blocked', t: 'waiting on you' }, { s: 'working', t: 'running tests' }, { s: 'idle', t: 'ready' }] as row (row.s)}
			<span class="flex items-center gap-2">
				{#if prefs.value.statusIndicators === 'dot'}
					<span class="h-1.5 w-1.5 shrink-0 rounded-full {STATUS_RAIL[row.s]}" aria-hidden="true"
					></span>
				{:else if prefs.value.statusIndicators === 'symbol'}
					<span
						class="w-2.5 shrink-0 text-center font-mono text-[10px] leading-none {STATUS_INK[
							row.s
						]}"
						aria-hidden="true">{STATUS_SYMBOL[row.s]}</span
					>
				{:else}
					<span class="w-[52px] shrink-0 font-mono text-[9.5px] {STATUS_INK[row.s]}"
						>{STATUS_WORD[row.s]}</span
					>
				{/if}
				<span class="text-[12px]">{row.t}</span>
			</span>
		{/each}
	</div>
{/snippet}

{#snippet gradientColours()}
	<div class="flex items-center gap-4 px-3.5 py-3">
		{#each [{ label: 'You', key: 'userGradientEnd' as const, base: sampleUserFill }, { label: 'Agent', key: 'agentGradientEnd' as const, base: sampleAgentFill }] as side (side.key)}
			<label class="flex flex-1 items-center gap-2 text-[13px] text-muted">
				<input
					type="color"
					value={prefs.value[side.key] || (side.base ? fillFar(side.base) : '#888888')}
					oninput={(e) => prefs.set(side.key, (e.currentTarget as HTMLInputElement).value)}
					class="h-8 w-10 shrink-0 rounded border border-edge bg-transparent"
					aria-label="{side.label} gradient end colour"
				/>
				{side.label}
			</label>
		{/each}
	</div>
	<button
		class="w-full px-3.5 pb-2 text-left text-[12px] text-working"
		onclick={() => prefs.reset('userGradientEnd', 'agentGradientEnd')}
	>
		Back to the derived ends
	</button>
{/snippet}

{#snippet palettePreview()}
	<div class="flex flex-wrap gap-2 rounded-lg bg-page p-2">
		{#each PALETTES as palette (palette.name)}
			<button
				class="flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1.5 text-[12px]"
				onclick={() => applyPalette(palette)}
			>
				<span class="h-3 w-3 rounded-full" style="background:{palette.user}"></span>
				<span class="h-3 w-3 rounded-full" style="background:{palette.agent}"></span>
				{palette.name}
			</button>
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

{#snippet listDetailPreview()}
	<div class="rounded-lg bg-page p-2 text-[12px]">
		<div class="flex items-center gap-2">
			<span class="flex-1 font-medium">checkout-flow</span>
			{#if prefs.value.listDetail}
				<span class="rounded bg-chip px-1 font-mono text-[9.5px] text-faint">on screen</span>
			{/if}
			<span class="font-mono text-[10.5px] text-working">working</span>
		</div>
		<p class="font-mono text-[11px] text-muted">
			<HarnessMark agent="claude" /> claude · ▸ Bash bun run build
		</p>
		{#if prefs.value.listDetail}
			<p class="font-mono text-[10.5px] text-faint">
				Opus 5 · high · 46% · 540K left · £12.40 · 45h40m
			</p>
		{/if}
	</div>
{/snippet}

{#snippet groupPreview()}
	<div class="rounded-lg bg-page p-2 text-[12px]">
		{#if prefs.value.groupBy === 'none'}
			<p class="text-muted">One flat list, no headings.</p>
		{:else}
			{@const heads =
				prefs.value.groupBy === 'workspace'
					? ['storefront', 'platform']
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
			storefront {#if prefs.value.rollup}<span class="text-faint">· 2 working · 1 idle</span>{/if}
		</p>
		<p class="pl-2 text-[12px]">checkout-flow</p>
	</div>
{/snippet}

{#snippet previewLinePreview()}
	<div class="rounded-lg bg-page p-2 text-[12px]">
		<p class="font-medium">checkout-flow</p>
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

{#snippet headerModelPreview()}
	<div class="rounded-lg bg-page p-2 font-mono text-[10.5px]">
		{#if prefs.value.headerModel === 'off'}
			<span class="text-path">~/code/platform</span>
			<span class="text-branch">&#xe0a0; main</span>
		{:else}
			<span class="text-working">Opus 5</span>
			{#if prefs.value.headerModel === 'model-effort'}<span class="text-faint">high</span>{/if}
			<span class="text-faint">·</span>
			<span class="text-path">~/code/platform</span>
			<span class="text-branch">&#xe0a0; main</span>
		{/if}
	</div>
{/snippet}

{#snippet subagentPreview()}
	<div class="flex items-center gap-1.5 overflow-hidden rounded-lg bg-page p-2">
		{#if prefs.value.subagentStrip === 'off'}
			<span class="text-[12px] text-muted">No strip; Task rows still open them.</span>
		{:else}
			<span
				class="flex shrink-0 items-center gap-1.5 rounded-full border border-edge px-2 py-1 text-[11px]"
			>
				<Spinner size={10} label="running" />
				<span class="font-mono text-working">Explore</span>
				<span class="text-muted">find the callers</span>
			</span>
			{#if prefs.value.subagentStrip === 'all'}
				<span
					class="flex shrink-0 items-center gap-1.5 rounded-full border border-hairline px-2 py-1 text-[11px] opacity-60"
				>
					<span class="font-mono text-muted">general-purpose</span>
					<span class="text-muted">research</span>
				</span>
			{:else}
				<span class="shrink-0 font-mono text-[10.5px] text-faint">+2 done</span>
			{/if}
		{/if}
	</div>
{/snippet}

{#snippet pullPreview()}
	<p class="font-mono text-[10.5px]">
		<span class="text-branch">&#xe0a0; main</span>
		<span class="text-faint">·</span>
		{#if prefs.value.headerPull === 'off'}
			<span class="text-faint">no pull request shown</span>
		{:else}
			<span class="text-branch">#945</span>
			{#if prefs.value.headerPull === 'checks'}<span class="text-done">&#x2713;</span>{/if}
		{/if}
	</p>
{/snippet}

{#snippet motionPreview()}
	<!--
		What the browser reports, spelled out. Without it a "System" that says
		no to an animation you can see everywhere else is unexplainable from
		inside the app.
	-->
	<p class="font-mono text-[10.5px] text-faint">
		your browser says {browserReduce ? 'prefers-reduced-motion: reduce' : 'no-preference'} ·
		{prefs.value.motion === 'none' || (prefs.value.motion === 'auto' && browserReduce)
			? 'Latest jumps'
			: 'Latest glides'}
	</p>
{/snippet}

{#snippet widthPreview()}
	<!-- The column, and how much of it the transcript takes. -->
	<div class="rounded-lg bg-page p-2">
		<div class="flex h-10 w-full items-stretch rounded border border-hairline bg-card p-0.5">
			<div
				class="rounded bg-chip {prefs.value.conversationWidth === 'full'
					? 'w-full'
					: prefs.value.conversationWidth === 'wide'
						? 'w-3/4'
						: 'w-1/2'}"
			></div>
		</div>
		<p class="mt-1 font-mono text-[10.5px] text-faint">
			{prefs.value.conversationWidth === 'full'
				? 'the whole column'
				: prefs.value.conversationWidth === 'wide'
					? 'up to 1280px'
					: 'up to 1024px'}
		</p>
	</div>
{/snippet}

{#snippet chromePreview()}
	<!--
		The three together, because they share a row and the question is always
		what the row ends up looking like rather than what one control does.
	-->
	<div class="flex items-center gap-1 rounded-lg bg-page p-2">
		{#if prefs.value.backButton !== 'off'}
			<span class="flex h-8 w-7 items-center justify-center text-[18px] text-muted">&#x2190;</span>
		{/if}
		{#if prefs.value.menuButton !== 'off'}
			<span class="flex h-9 w-9 items-center justify-center text-[22px] leading-none text-muted"
				>☰</span
			>
		{/if}
		{#if prefs.value.logoButton !== 'off'}
			<img src="/collie.svg" alt="" class="h-6 w-6" style="image-rendering: pixelated" />
		{/if}
		<span class="truncate text-[13px] font-medium">checkout-flow</span>
	</div>
	{#if [prefs.value.backButton, prefs.value.menuButton, prefs.value.logoButton].includes('mobile')}
		<p class="mt-1 text-[11.5px] text-faint">Anything set to Mobile is hidden on a desktop.</p>
	{/if}
{/snippet}

{#snippet drawerHomePreview()}
	<div class="flex items-center gap-1 rounded-lg bg-page p-2">
		<span class="flex h-9 w-9 items-center justify-center text-[22px] leading-none text-muted"
			>☰</span
		>
		{#if prefs.value.drawerHome === 'mark'}
			<img src="/collie.svg" alt="" class="h-6 w-6" style="image-rendering: pixelated" />
		{:else if prefs.value.drawerHome === 'icon'}
			<span class="flex h-9 w-9 items-center justify-center text-muted"
				><Icon name="home" size={18} /></span
			>
		{:else}
			<span class="text-[12px] text-faint">close the drawer and use the header</span>
		{/if}
	</div>
{/snippet}

{#snippet ticksPreview()}
	<div class="flex items-center gap-3 rounded-lg bg-page p-2 text-[12px] text-muted">
		<span class="flex items-center gap-1"><Ticks state="sending" /> sending</span>
		<span class="flex items-center gap-1"><Ticks state="sent" /> queued</span>
		<span class="flex items-center gap-1"><Ticks state="read" /> the agent has it</span>
	</div>
{/snippet}

{#snippet messageTimePreview()}
	<!--
		Two bubbles from the same speaker, so "per run" can be SEEN to differ
		from "every": it stamps the second and leaves the first bare.
	-->
	<div class="flex flex-col items-end gap-0.5 rounded-lg bg-page p-2">
		<Bubble
			mine
			run="first"
			small
			border={sampleUserBorder}
			fill={sampleUserFill}
			fillGradient={gradient}
			fillEnd={sampleUserEnd}
			tail={false}
			width={prefs.value.bubbleBorderWidth}
			ink={sampleUserInk}
		>
			any luck with that?
			{#snippet meta()}<BubbleMeta at={sampleAt} run="first" state="read" />{/snippet}
		</Bubble>
		<Bubble
			mine
			run="last"
			small
			border={sampleUserBorder}
			fill={sampleUserFill}
			fillGradient={gradient}
			fillEnd={sampleUserEnd}
			tail={prefs.value.bubbleTails}
			width={prefs.value.bubbleBorderWidth}
			ink={sampleUserInk}
		>
			no rush
			{#snippet meta()}<BubbleMeta at={sampleAt} run="last" state="read" />{/snippet}
		</Bubble>
	</div>
{/snippet}

{#snippet clockPreview()}
	<div class="rounded-lg bg-page p-2 font-mono text-[12px] text-muted">
		{clockTime(sampleAt, prefs.value.clockFormat)} · {clockTime(
			sampleEvening,
			prefs.value.clockFormat
		)}
	</div>
{/snippet}

{#snippet tabNamePreview()}
	<div class="rounded-lg bg-page p-2 text-[12px]">
		<p class="font-medium">it-cli</p>
		{#if prefs.value.showTabName}
			<p class="font-mono text-[11px] text-faint">&#x2299; Bitwarden CLI integration</p>
		{/if}
		<p class="font-mono text-[11px] text-muted">claude · ~/code/platform</p>
	</div>
{/snippet}

{#snippet backPreview()}
	<div class="rounded-lg bg-page p-2 text-[12px] text-muted">
		{#if prefs.value.backTo === 'home'}
			One <span class="font-mono">back</span> from anywhere inside an agent returns to the agents list.
			Move between panes with the tab strip or a swipe.
		{:else}
			<span class="font-mono">back</span> retraces every pane and screen you visited, one gesture at a
			time.
		{/if}
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
		{#if prefs.value.paneView === 'auto'}
			<div class="flex gap-2 text-[11px]">
				<div class="flex-1 rounded-md bg-card p-1.5">
					<p class="font-mono text-[10px] text-faint">a shell</p>
					<p class="term mt-0.5 text-[10px]">tony@tm-work ❯</p>
					<p class="mt-1 text-working">terminal</p>
				</div>
				<div class="flex-1 rounded-md bg-card p-1.5">
					<p class="font-mono text-[10px] text-faint">an agent</p>
					<p class="mt-0.5 text-[10px]">Written and committed.</p>
					<p class="mt-1 text-working">conversation</p>
				</div>
			</div>
			<p class="mt-1 text-[11px] text-faint">
				A shell has no transcript to render; an agent's reads back through the whole session, which
				its screen cannot.
			</p>
		{:else if prefs.value.paneView === 'terminal'}
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

{#snippet fitPreview()}
	<div class="rounded-lg bg-page p-2">
		<div class="term overflow-hidden rounded-md bg-card p-1.5 leading-[1.4]">
			{#if prefs.value.terminalFit === 'wrap'}
				<div class="text-[10.5px] whitespace-pre-wrap">
					CTX ▰▰▰▱▱ 46% · 540K left · a long status row that has been allowed to wrap onto the next
					line
				</div>
			{:else}
				<div
					class="text-[10.5px] whitespace-pre {prefs.value.terminalFit === 'native'
						? 'overflow-x-auto'
						: ''}"
					style={prefs.value.terminalFit === 'fit' ? 'font-size:8px' : ''}
				>
					CTX ▰▰▰▱▱ 46% · 540K left · a long status row kept on one line so its columns stay put
				</div>
			{/if}
		</div>
		<p class="mt-1 text-[11px] text-faint">
			{#if prefs.value.terminalFit === 'fit'}
				Type shrinks until the pane's width fits, down to 8px. Columns stay lined up.
			{:else if prefs.value.terminalFit === 'wrap'}
				Long lines wrap. Easier to read, but tables and bars lose their columns.
			{:else}
				The pane's own size, scrolling sideways when it is wider than the window.
			{/if}
		</p>
	</div>
{/snippet}

{#snippet densityPreview()}
	<div class="rounded-lg bg-page p-2">
		<div
			class="term overflow-hidden rounded-md bg-card text-[10px] {prefs.value.terminalDensity ===
			'compact'
				? 'px-1.5 py-0.5 leading-[1.15]'
				: 'px-3 py-2 leading-[1.35]'}"
		>
			{#each ['$ git status', 'On branch main', 'nothing to commit', '$ ls', 'bordr  repos'] as row (row)}
				<div class="whitespace-pre">{row}</div>
			{/each}
		</div>
		<p class="mt-1 text-[11px] text-faint">
			{prefs.value.terminalDensity === 'compact'
				? 'Tighter rows and less padding — more of the pane on screen.'
				: "The terminal's own spacing, with room around it."}
		</p>
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
			>{prefs.value.smartTabLabels ? 'checkout-flow' : 'tab 1'}</span
		>
		<span class="text-muted">{prefs.value.smartTabLabels ? '~/code/platform' : 'tab 2'}</span>
	</div>
{/snippet}

<div class="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0 lg:overflow-hidden">
	<!--
		The app bar, the same one the list and a conversation have. Settings had
		a bare `<h1>` and nothing else: no way home, no workspaces, and a page
		that did not look like it belonged to the app it was configuring.
	-->
	{#snippet title()}
		<h1 class="truncate text-[17px] font-semibold">Settings</h1>
	{/snippet}

	<header class="shrink-0 border-b border-hairline">
		<AppHeader
			onmenu={() => (treeOpen = true)}
			menuLabel="Workspaces"
			menuExpanded={treeOpen}
			middle={title}
		/>
	</header>

	<div class="lg:flex lg:min-h-0 lg:w-full lg:min-w-0 lg:flex-1">
		<!--
			Mounted only at desktop widths, not merely hidden: below `lg` every
			section is on the page already, so a nav there would be a list of
			links to things three inches further down.
		-->
		{#if screen.wide}
			<SettingsNav active={section} />
		{/if}

		<div class="flex min-w-0 flex-1 flex-col lg:min-h-0 lg:overflow-y-auto">
			<main
				class="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 pt-3 pb-24 lg:mx-0 lg:px-6 lg:pb-8"
			>
				{#if shown('agents list')}
					<SettingsSection heading="agents list">
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
							<ToggleRow
								label="Show grouping chips"
								checked={prefs.value.showGrouping}
								onchange={(v) => prefs.set('showGrouping', v)}
							/>
							<ToggleRow
								label="Tab name on each row"
								hint="The name you gave the work in herdr. Two panes in the same workspace, on the same harness, at the same status are otherwise identical rows."
								checked={prefs.value.showTabName}
								onchange={(v) => prefs.set('showTabName', v)}
							>
								{#snippet preview()}{@render tabNamePreview()}{/snippet}
							</ToggleRow>
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
								label="More on each row"
								hint="The harness's own status row — whichever one you settled on in a conversation — and a mark on the pane the terminal is looking at. Both come off readings the list already takes."
								checked={prefs.value.listDetail}
								onchange={(v) => prefs.set('listDetail', v)}
							>
								{#snippet preview()}{@render listDetailPreview()}{/snippet}
							</ToggleRow>
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
					</SettingsSection>
				{/if}

				{#if shown('appearance')}
					<SettingsSection heading="appearance">
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
					</SettingsSection>
				{/if}

				{#if shown('header')}
					<SettingsSection heading="header">
						<div
							class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
						>
							<SettingRow
								label="Back arrow"
								value={prefs.value.backButton}
								options={[
									{ v: 'always' as ChromeWhen, l: 'Always' },
									{ v: 'mobile' as ChromeWhen, l: 'Mobile' },
									{ v: 'off' as ChromeWhen, l: 'Off' }
								]}
								onchange={(v) => prefs.set('backButton', v)}
							>
								{#snippet preview()}{@render chromePreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								One step to the agents list. A conversation is the only screen with no tab bar — the
								composer has the bottom of it.
							</p>
							<SettingRow
								label="Menu button"
								value={prefs.value.menuButton}
								options={[
									{ v: 'always' as ChromeWhen, l: 'Always' },
									{ v: 'mobile' as ChromeWhen, l: 'Mobile' },
									{ v: 'off' as ChromeWhen, l: 'Off' }
								]}
								onchange={(v) => prefs.set('menuButton', v)}
							>
								{#snippet preview()}{@render chromePreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								Opens the machines, workspaces and panes. On a desktop it collapses the sidebar
								instead.
							</p>
							<SettingRow
								label="bordr mark"
								value={prefs.value.logoButton}
								options={[
									{ v: 'always' as ChromeWhen, l: 'Always' },
									{ v: 'mobile' as ChromeWhen, l: 'Mobile' },
									{ v: 'off' as ChromeWhen, l: 'Off' }
								]}
								onchange={(v) => prefs.set('logoButton', v)}
							>
								{#snippet preview()}{@render chromePreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								The collie, which is also a link to the agents list. It stands down under 360px when
								the back arrow is there, so the two cannot push the header off the screen.
							</p>
							<SettingRow
								label="Conversation width"
								value={prefs.value.conversationWidth}
								options={[
									{ v: 'comfortable' as ConversationWidth, l: 'Comfortable' },
									{ v: 'wide' as ConversationWidth, l: 'Wide' },
									{ v: 'full' as ConversationWidth, l: 'Full' }
								]}
								onchange={(v) => prefs.set('conversationWidth', v)}
							>
								{#snippet preview()}{@render widthPreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								Desktop only; a phone has one column either way. It was capped at 1024px however
								wide the window — at 1920 that left 620px of the column empty, and at 2560 it left
								1260px. A cap is not wrong, though: prose past about 90 characters a line is harder
								to read, which is why there was one. Diffs and terminal output want the room; long
								prose does not.
							</p>
							<SettingRow
								label="Pull request"
								value={prefs.value.headerPull}
								options={[
									{ v: 'off' as HeaderPull, l: 'Off' },
									{ v: 'number' as HeaderPull, l: 'Number' },
									{ v: 'checks' as HeaderPull, l: 'CI' }
								]}
								onchange={(v) => prefs.set('headerPull', v)}
							>
								{#snippet preview()}{@render pullPreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								Beside the branch, because it is the question you were asking the branch: is it up,
								and did it pass. Read with `gh` in the background, so the first look at a pane shows
								nothing and the next one has it, and only for panes on this machine — whether `gh`
								is installed and signed in on another machine is not something bordr can assume.
							</p>
							<SettingRow
								label="Motion"
								value={prefs.value.motion}
								options={[
									{ v: 'auto' as Motion, l: 'System' },
									{ v: 'full' as Motion, l: 'Always' },
									{ v: 'none' as Motion, l: 'Off' }
								]}
								onchange={(v) => prefs.set('motion', v)}
							>
								{#snippet preview()}{@render motionPreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								Whether "Latest" rides down to the bottom of a conversation or simply arrives.
								System is the right default — someone who has turned motion down at the system level
								means it — but the browser reads that through a desktop portal and can answer
								"reduce" on a machine whose animations are plainly on, which leaves the glide
								looking broken rather than switched off. What your browser currently says is above,
								so you can tell the two apart.
							</p>
							<SettingRow
								label="Tab strip"
								value={prefs.value.tabStrip}
								options={[
									{ v: 'always' as ChromeWhen, l: 'Always' },
									{ v: 'mobile' as ChromeWhen, l: 'Mobile' },
									{ v: 'off' as ChromeWhen, l: 'Off' }
								]}
								onchange={(v) => prefs.set('tabStrip', v)}
							>
								{#snippet preview()}{@render chromePreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								The tabs in this workspace and the panes in this tab. A swipe already moves between
								the same panes, so this is 40px you can have back.
							</p>
						</div>
						<p class="mt-1.5 px-1 text-[12px] text-muted">
							Measured on a 430&times;820 phone: the conversation header is 179px, 22% of the
							screen, in four rows. Moving the harness status to the bottom and turning the tab
							strip off takes it to 111px, 14%. The sub-agent row now appears only while one is
							actually working.
						</p>
					</SettingsSection>
				{/if}

				{#if shown('workspaces & panes')}
					<SettingsSection heading="workspaces &amp; panes">
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
								label="Status indicators"
								value={prefs.value.statusIndicators}
								options={[
									{ v: 'dot' as StatusIndicators, l: 'Dot' },
									{ v: 'symbol' as StatusIndicators, l: 'Symbol' },
									{ v: 'text' as StatusIndicators, l: 'Text' }
								]}
								onchange={(v) => prefs.set('statusIndicators', v)}
							>
								{#snippet preview()}{@render indicatorPreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								How an agent's state shows in the side list. Symbol adds a shape to the colour, so
								the list still sorts itself without relying on telling red from green.
							</p>
							<SettingRow
								label="Pane view"
								value={prefs.value.paneView}
								options={[
									{ v: 'auto' as PaneView, l: 'Auto' },
									{ v: 'conversation' as PaneView, l: 'Conversation' },
									{ v: 'terminal' as PaneView, l: 'Terminal' }
								]}
								onchange={(v) => prefs.set('paneView', v)}
							>
								{#snippet preview()}{@render paneViewPreview()}{/snippet}
							</SettingRow>
							<SettingRow
								label="Wide screens"
								value={prefs.value.terminalFit}
								options={[
									{ v: 'fit' as TerminalFit, l: 'Fit' },
									{ v: 'wrap' as TerminalFit, l: 'Wrap' },
									{ v: 'native' as TerminalFit, l: 'Native' }
								]}
								onchange={(v) => prefs.set('terminalFit', v)}
							>
								{#snippet preview()}{@render fitPreview()}{/snippet}
							</SettingRow>
							<SettingRow
								label="Terminal density"
								value={prefs.value.terminalDensity}
								options={[
									{ v: 'comfortable' as TerminalDensity, l: 'Comfortable' },
									{ v: 'compact' as TerminalDensity, l: 'Compact' }
								]}
								onchange={(v) => prefs.set('terminalDensity', v)}
							>
								{#snippet preview()}{@render densityPreview()}{/snippet}
							</SettingRow>
							<ToggleRow
								label="Git branch in the list and tree"
								hint="Branch and drift from its upstream, read from each directory; herdr does not serve it."
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
					</SettingsSection>
				{/if}

				{#if shown('input')}
					<SettingsSection heading="input">
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
							<SettingRow
								label="Back gesture"
								value={prefs.value.backTo}
								options={[
									{ v: 'home' as BackTo, l: 'Home' },
									{ v: 'history' as BackTo, l: 'Retrace' }
								]}
								onchange={(v) => prefs.set('backTo', v)}
							>
								{#snippet preview()}{@render backPreview()}{/snippet}
							</SettingRow>
							<SettingRow
								label="Home in the drawer"
								value={prefs.value.drawerHome}
								options={[
									{ v: 'mark' as DrawerHome, l: 'Mark' },
									{ v: 'icon' as DrawerHome, l: 'Icon' },
									{ v: 'off' as DrawerHome, l: 'Off' }
								]}
								onchange={(v) => prefs.set('drawerHome', v)}
							>
								{#snippet preview()}{@render drawerHomePreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								Phone only, and only inside an agent. The drawer covers the header, so the mark up
								there — already a link to this list — cannot be reached while it is open.
							</p>
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
					</SettingsSection>
				{/if}

				{#if shown('chat bubbles')}
					<SettingsSection heading="chat bubbles">
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
								<div class="px-3.5 py-3">
									<div class="mb-2 text-[15px]">Palette</div>
									<p class="mb-2 text-[12px] text-muted">
										Sets both sides at once. Under the outline style these colour the rule; under
										fill they colour the bubble.
									</p>
									{@render palettePreview()}
								</div>
								{#if prefs.value.bubbleFill}
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
								{/if}
								<ToggleRow
									label="Border"
									hint="A rule that fades away from the bubble's own tail."
									checked={prefs.value.bubbleBorder}
									onchange={(v) => prefs.set('bubbleBorder', v)}
								>
									{#snippet preview()}{@render bubblePreview()}{/snippet}
								</ToggleRow>
								{#if prefs.value.bubbleBorder}
									<SettingRow
										label="Thickness"
										value={prefs.value.bubbleBorderWidth}
										options={[
											{ v: 1, l: '1px' },
											{ v: 2, l: '2px' },
											{ v: 3, l: '3px' }
										]}
										onchange={(v) => prefs.set('bubbleBorderWidth', v)}
									/>
									{@render borderColours()}
									<ToggleRow
										label="Tails"
										hint="The pointer on the last bubble of a run. Off leaves the squared corner."
										checked={prefs.value.bubbleTails}
										onchange={(v) => prefs.set('bubbleTails', v)}
									/>
								{/if}
								<ToggleRow
									label="Fill"
									hint="Off leaves the text on the page, which is what reads as an outline."
									checked={prefs.value.bubbleFill}
									onchange={(v) => prefs.set('bubbleFill', v)}
								/>
								{#if prefs.value.bubbleFill}
									<SettingRow
										label="Fill style"
										value={prefs.value.fillStyle}
										options={[
											{ v: 'solid' as FillStyle, l: 'Solid' },
											{ v: 'gradient' as FillStyle, l: 'Gradient' }
										]}
										onchange={(v) => prefs.set('fillStyle', v)}
									/>
									<p class="px-3.5 pb-2 text-[12px] text-muted">
										Solid lays the colour flat. Gradient fades it away from the bubble's own tail,
										the same way the border does.
									</p>
									{#if prefs.value.fillStyle === 'gradient'}
										<SettingRow
											label="Fades to"
											value={prefs.value.gradientEnd}
											options={[
												{ v: 'auto' as GradientEnd, l: 'Auto' },
												{ v: 'harness' as GradientEnd, l: 'Agent' },
												{ v: 'custom' as GradientEnd, l: 'Custom' }
											]}
											onchange={(v) => prefs.set('gradientEnd', v)}
										/>
										<p class="px-3.5 pb-2 text-[12px] text-muted">
											Auto picks an end that keeps the text readable whatever the fill is. Agent
											fades towards the harness colour, so the bubble carries who is speaking — your
											own side has no harness, so it stays on auto. Custom is yours.
										</p>
										{#if prefs.value.gradientEnd === 'custom'}
											{@render gradientColours()}
										{/if}
										<!--
								Auto cannot be unreadable; the other two can. A pale fill fading
								into a dark harness colour has no single ink that works, and that
								is a choice this screen can measure but not make.
							-->
										{#if prefs.value.gradientEnd !== 'auto' && gradientWorst < 4.5}
											<p class="px-3.5 pb-2 text-[12px] text-danger-ink">
												Text drops to {gradientWorst.toFixed(1)}:1 at one end — under the 4.5:1
												needed to read comfortably.
											</p>
										{/if}
									{/if}
								{/if}
								<SettingRow
									label="Harness accent"
									value={prefs.value.harnessAccent}
									options={[
										{ v: 'edge' as HarnessAccent, l: 'Edge' },
										{ v: 'tint' as HarnessAccent, l: 'Tint' },
										{ v: 'fill' as HarnessAccent, l: 'Fill' },
										{ v: 'off' as HarnessAccent, l: 'Off' }
									]}
									onchange={(v) => prefs.set('harnessAccent', v)}
								>
									{#snippet preview()}{@render accentPreview()}{/snippet}
								</SettingRow>
								<p class="px-3.5 pb-2 text-[12px] text-muted">
									Edge puts the harness's colour in the rule. Tint also blends it faintly into the
									bubble; fill uses it at full strength and picks readable text to go on it. A
									colour picked above overrides all three.
								</p>
								<button
									class="w-full px-3.5 py-3 text-left text-[15px] text-working"
									onclick={() =>
										prefs.reset(
											'userBubble',
											'userText',
											'agentBubble',
											'agentText',
											'userBorder',
											'agentBorder'
										)}
								>
									Reset colours
								</button>
							{/if}
						</div>
					</SettingsSection>
				{/if}

				{#if shown('transcript')}
					<SettingsSection heading="transcript">
						<div
							class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
						>
							<ToggleRow
								label="Delivery ticks on your messages"
								hint="A spinner while it is being sent, one tick once herdr has it, two once the agent has taken it — read from the harness's own queue, not guessed from the screen."
								checked={prefs.value.messageTicks}
								onchange={(v) => prefs.set('messageTicks', v)}
							>
								{#snippet preview()}{@render ticksPreview()}{/snippet}
							</ToggleRow>
							<SettingRow
								label="Message times"
								value={prefs.value.messageTime}
								options={[
									{ v: 'off' as MessageTime, l: 'Off' },
									{ v: 'runs' as MessageTime, l: 'Per run' },
									{ v: 'all' as MessageTime, l: 'Every' }
								]}
								onchange={(v) => prefs.set('messageTime', v)}
							>
								{#snippet preview()}{@render messageTimePreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								Per run stamps only the last bubble of a run from the same speaker: five replies
								inside the same minute get one time, not five.
							</p>
							<SettingRow
								label="Clock"
								value={prefs.value.clockFormat}
								options={[
									{ v: 'auto' as ClockFormat, l: 'Device' },
									{ v: 'h24' as ClockFormat, l: '24-hour' },
									{ v: 'h12' as ClockFormat, l: '12-hour' }
								]}
								onchange={(v) => prefs.set('clockFormat', v)}
							>
								{#snippet preview()}{@render clockPreview()}{/snippet}
							</SettingRow>
							<SettingRow
								label="Model in the header"
								value={prefs.value.headerModel}
								options={[
									{ v: 'off' as HeaderModel, l: 'Off' },
									{ v: 'model' as HeaderModel, l: 'Model' },
									{ v: 'model-effort' as HeaderModel, l: '+ effort' }
								]}
								onchange={(v) => prefs.set('headerModel', v)}
							>
								{#snippet preview()}{@render headerModelPreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								The model comes from the transcript, where the harness records it, so it is right on
								any machine. Effort is only ever in the status line — no harness writes it down and
								herdr has no concept of it — so it is shown when that line clearly carries one and
								left out when it does not.
							</p>
							<SettingRow
								label="Sub-agents above the conversation"
								value={prefs.value.subagentStrip}
								options={[
									{ v: 'off' as SubagentStrip, l: 'Off' },
									{ v: 'running' as SubagentStrip, l: 'Running' },
									{ v: 'all' as SubagentStrip, l: 'All' }
								]}
								onchange={(v) => prefs.set('subagentStrip', v)}
							>
								{#snippet preview()}{@render subagentPreview()}{/snippet}
							</SettingRow>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								A Task spawns an agent with its own transcript. Running shows only the ones still
								working and folds the rest behind a count; the Task rows in the transcript open any
								of them either way.
							</p>
							<ToggleRow
								label="Group tool calls"
								hint="A run of turns that only ran tools folds into one row you can open. A single call is left alone."
								checked={prefs.value.groupTools}
								onchange={(v) => prefs.set('groupTools', v)}
							/>
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
					</SettingsSection>
				{/if}

				{#if shown('notifications')}
					<SettingsSection heading="notifications">
						<div
							class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
						>
							<!--
								Dismissing the install banner hides it for sixty days, and there was
								no way back to it — the one control in the app with no route to undo
								it. Only shown once it has actually been dismissed.
							-->
							{#if installHidden}
								<button
									class="flex w-full items-center gap-3 px-3.5 py-3 text-left"
									onclick={showInstall}
								>
									<span class="min-w-0 flex-1">
										<span class="block text-[15px]">Offer to install bordr again</span>
										<span class="block text-[12px] text-muted"
											>The badge, the share sheet and answer buttons on a notification only work for
											an installed app.</span
										>
									</span>
									<span class="shrink-0 text-[13px] text-working">Show</span>
								</button>
							{/if}
							<ToggleRow
								label="Count waiting agents on the app icon"
								hint="A badge on the installed app, like a mail app. A notification cannot still be there tomorrow; this can. Chrome on Android has no badging API at all, and on macOS it needs notification permission as well."
								checked={prefs.value.appBadge}
								onchange={(v) => prefs.set('appBadge', v)}
							/>
							<SettingRow
								label="Sound while the app is open"
								value={prefs.value.soundAlerts}
								options={[
									{ v: 'off' as SoundAlerts, l: 'Off' },
									{ v: 'attention' as SoundAlerts, l: 'Needs you' },
									{ v: 'all' as SoundAlerts, l: 'And done' }
								]}
								onchange={(v) => prefs.set('soundAlerts', v)}
							/>
							<p class="px-3.5 pb-2 text-[12px] text-muted">
								A short tone when an agent changes state. Push covers the app being closed; this
								covers it being open, where a notification is either suppressed or redundant. Phones
								only start audio after you have touched the page, so the first tone of a visit may
								not sound.
							</p>
							{#if pushState === 'unsupported'}
								<p class="px-3.5 py-3 text-[13px] text-muted">
									This browser has no Push API. Add bordr to your home screen over HTTPS to enable
									it.
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
					</SettingsSection>
				{/if}

				{#if shown('connection')}
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
				{/if}
			</main>
		</div>
	</div>

	{#if treeOpen}
		<div class="fixed inset-0 z-40">
			<button
				class="absolute inset-0 bg-black/40"
				aria-label="Close the workspaces list"
				onclick={() => (treeOpen = false)}
			></button>
			<div class="absolute inset-y-0 left-0 w-[86%] max-w-[320px] shadow-2xl">
				<SessionTree />
			</div>
		</div>
	{/if}

	<TabBar />
</div>
