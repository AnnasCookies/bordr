<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import { resolve } from '$app/paths';
	import { agentStore } from '$lib/agents.svelte';
	import { mergeResults } from '$lib/dictation';
	import { shrinkImage } from '$lib/shrink-image';
	import { prefs } from '$lib/prefs.svelte';
	import { agentTitle, collapseHome, flatOrder } from '$lib/grouping';
	import { decideSwipe, inHorizontalScroller, neighbourPane } from '$lib/swipe';
	import { harnessBorder, harnessBubble, harnessHex, harnessText, STATUS_INK } from '$lib/theme';
	import { ansiToHtml } from '$lib/ansi';
	import { termGrid } from '$lib/term-grid';
	import { throttleTrailing } from '$lib/throttle';
	import { createSessionDraftStore, type SessionDraftStore } from '$lib/session-draft';
	import { rankCommands, type SlashCommand } from '$lib/commands';
	import { bubbleInk, DEFAULT_FILL, DEFAULT_USER } from '$lib/bubble-colour';
	import {
		messageSegments,
		hasTodoPlan,
		onlyToolWork,
		proseBlocks,
		workBlocks,
		type MessageSegment
	} from '$lib/message-segments';
	import HarnessMark from '$lib/components/harness-mark.svelte';
	import StatusMark from '$lib/components/status-mark.svelte';
	import Bubble from '$lib/components/bubble.svelte';
	import AppHeader from '$lib/components/app-header.svelte';
	import PaneTerminal from '$lib/components/pane-terminal.svelte';
	import PaneScreen from '$lib/components/pane-screen.svelte';
	import PaneSplit from '$lib/components/pane-split.svelte';
	import Icon from '$lib/components/icon.svelte';
	import MessageBlocks from '$lib/components/message-blocks.svelte';
	import SessionTree from '$lib/components/session-tree.svelte';
	import SidebarResizer from '$lib/components/sidebar-resizer.svelte';
	import { DEFAULT_SIDEBAR } from '$lib/sidebar';
	import WorkspaceTabs from '$lib/components/workspace-tabs.svelte';
	import StatusBlock from '$lib/components/status-block.svelte';
	import NewAgentSheet from '$lib/components/new-agent-sheet.svelte';
	import ControlSheet from '$lib/components/control-sheet.svelte';
	import type { ControlScope } from '$lib/components/control-sheet.svelte';
	import WorktreeSheet from '$lib/components/worktree-sheet.svelte';
	import SubagentSheet from '$lib/components/subagent-sheet.svelte';
	import Spinner from '$lib/components/spinner.svelte';
	import Ticks from '$lib/components/ticks.svelte';
	import BubbleMeta from '$lib/components/bubble-meta.svelte';
	import { track } from '$lib/pending.svelte';
	import { nextFollowing } from '$lib/follow';
	import { swipeSequence } from '$lib/swipe-order';
	import { showChrome, touchPoints } from '$lib/header-chrome';
	import { afterClose } from '$lib/after-close';
	import { keepPending, onScreen, say, type PendingSend } from '$lib/pending-sends';
	import { queueVerdict } from '$lib/queue';
	import { parseModelLine } from '$lib/model-line';
	import type { Block } from '$lib/server/transcript/types';
	import type { AgentStatus, SplitNode, WorkspaceNode } from '$lib/types';
	let { data } = $props();
	const detail = $derived(data.detail);

	const TAIL = 80;

	/**
	 * Tool calls, results and thinking. Starts from the persisted preference
	 * so the choice survives leaving the conversation — it used to reset to
	 * hidden on every open, which made the work look like it was not there.
	 */
	let showWork = $state(prefs.value.showWork);
	/** The ＋ in the desktop tree opens the same sheet the agents list uses. */
	let showNewAgent = $state(false);
	/** The sub-agent being read, if any. */
	let openSub = $state<string | null>(null);
	/** The session tree as a drawer, on a phone. */
	let treeOpen = $state(false);

	/**
	 * Hold the page still while the drawer is over it.
	 *
	 * The drawer is `fixed inset-0` and scrolls nothing itself, so a drag
	 * anywhere on it scrolled the transcript underneath. On a phone that also
	 * collapses and expands the browser's own chrome, which changes the
	 * viewport height the drawer is pinned to — so the panel jumped about
	 * while you were only trying to read the list. Locking the body stops
	 * both, and the drawer's own lists carry `overscroll-contain` so reaching
	 * the end of one does not start the page moving again.
	 */
	$effect(() => {
		if (!treeOpen) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});
	/** Whether the desktop sidebar has room. Matches Tailwind's lg breakpoint. */
	let wideScreen = $state(false);

	/**
	 * The split this pane lives in, when it shares its tab with others.
	 *
	 * Polled with the tree rather than carried on the pane detail: the layout
	 * belongs to the TAB, and it changes when someone splits or closes a pane
	 * in the terminal, not when this conversation moves on.
	 */
	let workspaces = $state<WorkspaceNode[]>([]);

	/** Whether the rebuilt split actually contains a given pane. */
	function treeHolds(node: SplitNode | undefined, paneId: string): boolean {
		if (!node) return false;
		if (node.kind === 'pane') return node.paneId === paneId;
		return treeHolds(node.first, paneId) || treeHolds(node.second, paneId);
	}

	const splitLayout = $derived.by(() => {
		if (!prefs.value.splitPanes) return undefined;
		for (const workspace of workspaces) {
			for (const tab of workspace.tabs) {
				if (!tab.panes.some((p) => p.paneId === detail.paneId)) continue;
				if (tab.panes.length <= 1) return undefined;
				// The split renders the conversation only in the tile whose leaf
				// is this pane. If the rebuilt tree does not hold it — a layout
				// herdr reported oddly, or a snapshot fetched a beat before a
				// pane was added — that tile never renders and the screen has no
				// transcript and no composer, silently. Falling back to the
				// plain conversation loses the split and keeps the app usable.
				return treeHolds(tab.layout?.tree, detail.paneId) ? tab.layout : undefined;
			}
		}
		return undefined;
	});

	/** The tab id the split belongs to, which set_split_ratio needs. */
	const splitTabId = $derived(
		workspaces.flatMap((w) => w.tabs).find((t) => t.panes.some((p) => p.paneId === detail.paneId))
			?.tabId ?? ''
	);

	async function loadLayout() {
		try {
			const res = await fetch('/api/panes');
			if (res.ok) workspaces = (await res.json()).workspaces ?? [];
		} catch {
			// Keep the last layout rather than collapsing the split mid-turn.
		}
	}

	$effect(() => {
		void loadLayout();
		const timer = setInterval(() => void loadLayout(), 5000);
		return () => clearInterval(timer);
	});

	/** Move a divider — in herdr, not just here. */
	async function setRatio(path: boolean[], ratio: number) {
		if (!splitTabId) return;
		try {
			await fetch('/api/layout', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ tabId: splitTabId, path, ratio })
			});
			await loadLayout();
		} catch {
			// herdr's real ratio comes back on the next poll either way.
		}
	}

	/**
	 * The drawer closes once the new pane has loaded, NOT when the link is
	 * tapped.
	 *
	 * Closing it in the click handler unmounted the anchor mid-gesture, and on
	 * touch that cancelled the navigation outright — the tap did nothing at
	 * all, while a mouse click completed and hid the bug.
	 */
	let drawerPane = '';
	$effect(() => {
		const pane = detail.paneId;
		// Only when the pane actually CHANGES. `detail` is replaced on every
		// refresh, so an effect that merely reads it fires every few seconds —
		// which slammed the drawer shut the instant it was opened.
		if (drawerPane && drawerPane !== pane) treeOpen = false;
		drawerPane = pane;
	});

	$effect(() => {
		const query = window.matchMedia('(min-width: 1024px)');
		const sync = () => {
			wideScreen = query.matches;
			// A drawer left open behind a rotation would sit under the sidebar.
			if (query.matches) treeOpen = false;
		};
		sync();
		query.addEventListener('change', sync);
		return () => query.removeEventListener('change', sync);
	});

	function prose(message: { blocks?: Block[] }): Block[] {
		return proseBlocks(message.blocks);
	}

	function work(message: { blocks?: Block[] }): Block[] {
		return workBlocks(message.blocks);
	}

	/**
	 * The manual harness controls: the screen peek and the key strip together.
	 * They belong together — you press a key and watch the screen react — and
	 * the ⌨ button is what shows and hides them. `keyStrip` in Settings only
	 * decides whether they start open.
	 */
	let showControls = $state(prefs.value.keyStrip === 'always');
	let draft = $state('');
	let draftPaneId = '';
	let draftStore: SessionDraftStore | undefined;

	/** A draft that starts with `!` is a shell command Claude Code will run. */
	// The bare `!` counts: the box must say what it is the moment the key is
	// pressed, not once a command has been typed after it.
	const isShell = $derived(draft.startsWith('!'));

	let textarea = $state<HTMLTextAreaElement | undefined>();

	/**
	 * The `/` list. The harness's own popup never reaches the phone (a
	 * message is sent whole), so bordr keeps the list itself: the harness's
	 * built-ins plus the person's skills, commands and plugins, fetched once
	 * per pane the first time a slash is typed and ranked here as they type.
	 */
	let commandList = $state<SlashCommand[] | null>(null);
	let commandsPane = '';
	let commandsLoading = false;
	/** The draft while it is still a single slash-word: the query for the list. */
	const slashQuery = $derived(/^\/\S*$/.test(draft) ? draft : null);
	const suggestions = $derived(
		slashQuery && commandList ? rankCommands(commandList, slashQuery) : []
	);
	$effect(() => {
		if (!slashQuery) return;
		const pane = detail.paneId;
		if (commandsPane === pane && (commandList !== null || commandsLoading)) return;
		commandsPane = pane;
		commandsLoading = true;
		commandList = null;
		fetch(`/api/agents/${encodeURIComponent(pane)}/commands`)
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { commands?: SlashCommand[] } | null) => {
				commandList = body?.commands ?? [];
			})
			.catch(() => {
				commandList = [];
			})
			.finally(() => {
				commandsLoading = false;
			});
	});

	/** Fill the command in and hand focus back; the send button is beside it. */
	function pickCommand(command: SlashCommand) {
		draft = `/${command.name} `;
		textarea?.focus();
	}
	let busy = $state(false);
	/**
	 * Which picker option is in flight, and whether a stop is.
	 *
	 * `busy` alone only said "something is happening somewhere on this page",
	 * so every option dimmed together and the one you actually tapped was not
	 * marked. On a slow link that reads as nothing having happened, and the
	 * next tap sends a second keystroke to a terminal.
	 */
	let sendingIndex = $state(-1);
	let stopping = $state(false);

	/**
	 * A question this pane has already answered, kept until the picker for it
	 * actually goes away.
	 *
	 * `detail.picker` is read off the terminal screen, so it survives the
	 * answer by however long the next read takes. Without this the card went
	 * spinner, then back to looking like a brand new unanswered question, then
	 * vanished a second or two later — and the obvious thing to do with a
	 * question that has apparently come back is to answer it again.
	 *
	 * Only set when the SERVER confirmed the screen moved (`outcome: 'ok'`).
	 * An unconfirmed send leaves the card up on purpose: that is the case
	 * where you do need to look.
	 *
	 * Keyed on the question and its options, not on a flag, so the next
	 * question — even one asked a moment later — is not swallowed with it.
	 */
	let answeredKey = $state('');
	let answeredAt = $state(0);

	const pickerKey = $derived(
		detail.picker
			? [detail.picker.question, ...detail.picker.options.map((o) => `${o.index}:${o.label}`)].join(
					'\u0000'
				)
			: ''
	);

	/**
	 * Held for at most this long. If the picker is still on screen after it,
	 * something did not go the way the server said it did, and a card you
	 * cannot see is worse than one that came back.
	 */
	const ANSWERED_HOLD_MS = 8_000;

	let now = $state(Date.now());
	$effect(() => {
		if (!answeredKey) return;
		const timer = setInterval(() => {
			now = Date.now();
			// Once the hold is up the key has done its job, whether or not the
			// picker went away — dropping it stops this tick rather than leaving
			// a half-second timer running for as long as the pane stays open.
			if (now - answeredAt >= ANSWERED_HOLD_MS) answeredKey = '';
		}, 500);
		return () => clearInterval(timer);
	});

	const askHidden = $derived(
		answeredKey !== '' && answeredKey === pickerKey && now - answeredAt < ANSWERED_HOLD_MS
	);

	// The picker went away, which is the answer landing: forget it, so an
	// identical question later is not matched against a stale key.
	$effect(() => {
		if (!detail.picker && answeredKey) answeredKey = '';
	});
	let shown = $state(TAIL);
	let loadingEarlier = $state(false);
	let attachments = $state<File[]>([]);
	let previews = $state<string[]>([]);
	// $state because the composer is now one branch of a conditional: the
	// binding is written when that branch mounts, not once at startup.
	let fileInput = $state<HTMLInputElement | undefined>();
	let dictating = $state(false);
	/** What the engine is hearing right now, before it commits a sentence. */
	let interim = $state('');
	let recognition: { stop: () => void; start: () => void } | null = null;
	/** The person's intent, distinct from whether the engine happens to be running. */
	let wantDictation = false;
	let dictationStartedAt = 0;
	let quickEnds = 0;
	/** The draft as it stood when the current engine session began. */
	let dictationBase = '';
	/**
	 * Screen Wake Lock, held while dictating. The phone's screen timing out
	 * locks the page and kills the microphone mid-sentence; holding the lock
	 * keeps the display on until stop is tapped. Best effort: unsupported
	 * browsers simply time out as before.
	 */
	let wakeLock: WakeLockSentinel | null = null;
	let screenHeld = $state(false);

	async function holdScreen() {
		if (wakeLock || !('wakeLock' in navigator)) return;
		try {
			wakeLock = await navigator.wakeLock.request('screen');
			screenHeld = true;
			wakeLock.addEventListener('release', () => {
				wakeLock = null;
				screenHeld = false;
			});
		} catch {
			// Denied (low battery mode, or not a secure context): dictation still works.
		}
	}

	function releaseScreen() {
		void wakeLock?.release();
		wakeLock = null;
		screenHeld = false;
	}

	/** The browser drops the lock when the page is hidden; take it back on return. */
	function onVisibility() {
		markRead();
		if (document.visibilityState !== 'visible') return;
		// Whatever happened while the phone was locked has not been fetched.
		refreshGate.call();
		if (dictating) void holdScreen();
	}
	/** Which scope the controls sheet is open for, if any. */
	async function afterControl(action: 'focus' | 'rename' | 'close', scope: ControlScope) {
		if (action !== 'close') {
			await invalidateAll();
			return;
		}
		// Replace rather than push: the pane behind this entry is gone, so back
		// would land on a 404 for something the reader closed on purpose.
		const next = afterClose({
			scope,
			current: detail.paneId,
			siblings: tabSiblings,
			all: order
		});
		await goto(next ? resolve('/a/[pane]', { pane: next }) : resolve('/'), {
			replaceState: true
		});
	}

	let controlling = $state(false);
	let worktrees = $state(false);
	/** The pane, and the tab holding it — both worth naming, one sheet. */
	const controlTargets = $derived(
		[
			{ scope: 'pane' as const, id: detail.paneId, label: detail.title || detail.paneId },
			detail.tabId ? { scope: 'tab' as const, id: detail.tabId, label: detail.tabLabel } : null
		].filter((target) => target !== null)
	);

	let statusOpen = $state(false);
	let uncertain = $state<string | null>(null);
	let sendError = $state<string | null>(null);
	let scrollback = $state<string | null>(null);
	let scrollbackLines = $state(400);
	let loadingBack = $state(false);
	let scrollbackError = $state<string | null>(null);
	let flashKey = $state('');

	/** Sub-agents this session has spawned, and the one being read. */
	const subs = $derived(detail.subagents ?? []);
	/**
	 * Running sub-agents are live information and belong at the top; finished
	 * ones are an archive and do not.
	 *
	 * The strip used to list every sub-agent a session had ever spawned, for as
	 * long as the session lived — four research agents that finished ninety
	 * minutes ago still sat across the header, growing the sticky bar and
	 * pushing the transcript down, with nothing left to say. The finished ones
	 * are still one tap away behind their count.
	 */
	const strip = $derived(prefs.value.subagentStrip);
	const running = $derived(strip === 'off' ? [] : subs.filter((a) => !a.done));
	const finished = $derived(strip === 'off' ? [] : subs.filter((a) => a.done));
	let showFinished = $state(false);
	// 'all' is the old behaviour, kept for anyone who wants it: every sub-agent
	// the session ever spawned, with no count to expand.
	const shownSubs = $derived(strip === 'all' || showFinished ? [...running, ...finished] : running);
	const openSubAgent = $derived(subs.find((a) => a.id === openSub) ?? null);

	/**
	 * Restore and save the composer by pane. The store collapses a typing burst
	 * into one localStorage write, while pane changes flush the old pane first.
	 */
	$effect(() => {
		const paneId = detail.paneId;
		const draftValue = draft;
		if (!draftStore) return;
		if (draftPaneId !== paneId) {
			draftPaneId = paneId;
			draft = draftStore.load(paneId);
			return;
		}
		draftStore.schedule(paneId, draftValue);
	});

	/**
	 * A pane with no agent in it.
	 *
	 * herdr leaves the agent field off a plain shell, which the detail turns
	 * into 'unknown'; every real harness names itself.
	 */
	const shellPane = $derived(detail.agent === '' || detail.agent === 'unknown');

	/**
	 * Which view this pane gets.
	 *
	 * 'auto' is the default and picks per pane, because the two views are good
	 * at different things. A shell HAS no transcript — conversation mode falls
	 * back to a screen dump for one anyway — while an agent's transcript reads
	 * back through the whole session, which the screen cannot: herdr keeps
	 * about a screenful per pane and no more.
	 */
	const terminalView = $derived(
		prefs.value.paneView === 'terminal' || (prefs.value.paneView === 'auto' && shellPane)
	);

	/**
	 * The status footer with its terminal colour. `statusAnsi` carries the
	 * same lines as `statusLines` with their escapes intact; the fallback
	 * covers a payload cached on a phone that has not reloaded yet.
	 */
	const statusRows = $derived(detail.statusAnsi?.length ? detail.statusAnsi : detail.statusLines);

	/**
	 * The model and effort, off the plain status lines.
	 *
	 * `statusLines` rather than `statusAnsi`: the two carry the same text and
	 * only the plain one is free of escape sequences, which would land in the
	 * middle of a field this has to cut at a glyph boundary.
	 */
	const modelLine = $derived.by(() => {
		if (prefs.value.headerModel === 'off') return { model: '', effort: '' };
		const line = parseModelLine(detail.statusLines ?? []);
		// The transcript is the source: the HARNESS wrote it, so it reads the
		// same on every machine. The status line only stands in for a harness
		// whose transcript bordr could not read — it is the USER'S line, laid
		// out however they like, so it is a fallback and never the truth.
		const model = detail.model || line.model;
		// Effort exists nowhere else at all — not in either transcript, and not
		// in herdr, whose API schema does not contain the word once.
		return { model, effort: prefs.value.headerModel === 'model' ? '' : line.effort };
	});

	/**
	 * How the harness shows on an agent bubble.
	 *
	 * 'edge' is the default because blending an accent into the background
	 * muddies it — orange into a light grey is a dull beige, and every theme
	 * colour it touches shifts. A stripe down the side carries the accent at
	 * full strength and leaves the bubble the colour it was.
	 */
	const accentMode = $derived(prefs.value.agentBubble ? 'off' : prefs.value.harnessAccent);

	/**
	 * A bubble drawn as an outline whose rule fades out from its own tail.
	 *
	 * `border-color` cannot take a gradient, so the rule is PAINTED rather
	 * than stroked: the fill is clipped to `padding-box`, the gradient to
	 * `border-box`, and the 1px border stays transparent — it exists only to
	 * reserve the strip the gradient shows through.
	 *
	 * The direction anchors on the speaker's own tail corner — `to top right`
	 * away from an agent's bottom-left, `to top left` away from a user's
	 * bottom-right — so both sides lean towards whoever is talking. A radial
	 * would not stretch with the message, but a diagonal keeps the two sides
	 * mirror images of each other, which is the point here.
	 *
	 * `fill` is the page colour by default, which is what makes it read as an
	 * outline; a bubble colour set in settings still wins, and then the same
	 * rule reads as a filled bubble with a fading edge.
	 */

	/**
	 * Fill and border are independent — either, both or neither — and each
	 * side has its own colour for each. Border alone is the outline look,
	 * fill alone is the older solid bubble, both is a filled bubble with a
	 * rule, neither leaves the text bare on the page.
	 *
	 * The three harness-accent modes still mean what they meant:
	 *
	 *   edge  the agent's border carries the harness colour (the default)
	 *   tint  it does too, and the fill takes the faint blend
	 *   off   the border falls back to the neutral edge — no harness anywhere
	 */
	const dark = $derived(prefs.resolvedTheme === 'dark');

	const agentBorder = $derived(
		prefs.value.bubbleBorder
			? prefs.value.agentBorder ||
					(accentMode === 'off' ? 'var(--edge)' : harnessHex(detail.agent, dark))
			: null
	);
	const userBorder = $derived(
		prefs.value.bubbleBorder
			? prefs.value.userBorder || (dark ? DEFAULT_USER.dark : DEFAULT_USER.light)
			: null
	);

	/**
	 * `fill` implies a fill even when the Fill toggle is off — picking it is
	 * asking for a harness-coloured bubble, and doing nothing until a second
	 * switch is also found would just read as broken.
	 */
	const agentFill = $derived(
		prefs.value.bubbleFill || accentMode === 'fill'
			? prefs.value.agentBubble ||
					(accentMode === 'fill'
						? harnessHex(detail.agent, dark)
						: accentMode === 'tint'
							? harnessBubble(detail.agent, dark, dark ? DEFAULT_FILL.dark : DEFAULT_FILL.light)
							: dark
								? DEFAULT_FILL.dark
								: DEFAULT_FILL.light)
			: null
	);
	const userFill = $derived(
		prefs.value.bubbleFill
			? prefs.value.userBubble || (dark ? DEFAULT_USER.dark : DEFAULT_USER.light)
			: null
	);

	/**
	 * Where a fill's fade ends.
	 *
	 * `auto` derives it from the fill so the text is readable by construction.
	 * `harness` hands the far end to the agent's own colour, which puts who is
	 * speaking into the bubble itself. `custom` is whatever was picked. Null
	 * means auto, which is what the component falls back to.
	 */
	function gradientEndFor(side: 'user' | 'agent'): string | null {
		if (prefs.value.fillStyle !== 'gradient') return null;
		const mode = prefs.value.gradientEnd;
		if (mode === 'custom') {
			return (side === 'user' ? prefs.value.userGradientEnd : prefs.value.agentGradientEnd) || null;
		}
		// The user has no harness of their own, so theirs stays derived.
		if (mode === 'harness' && side === 'agent') return harnessHex(detail.agent, dark);
		return null;
	}

	const agentEnd = $derived(gradientEndFor('agent'));
	const userEnd = $derived(gradientEndFor('user'));

	/** Text with no fill behind it sits on the page, so it takes the page's ink. */
	/**
	 * Text is picked against the fill it actually sits on, across the whole of
	 * it. A fill is a colour nobody chose for legibility — grok's rose and
	 * agy's lime want opposite text — and a faded one is two colours, so the
	 * choice has to hold at both ends.
	 */
	const gradient = $derived(prefs.value.fillStyle === 'gradient');
	const agentInk = $derived(
		!agentFill ? 'var(--ink)' : prefs.value.agentText || bubbleInk(agentFill, dark, gradient)
	);
	const userInk = $derived(
		!userFill ? 'var(--ink)' : prefs.value.userText || bubbleInk(userFill, dark, gradient, userEnd)
	);

	/**
	 * Whether the radio is on at all.
	 *
	 * `navigator.onLine` is a weak signal — it says the interface is up, not
	 * that anything is reachable — but it is the only one that is instant, and
	 * it is the one case where no amount of retrying helps.
	 */
	/**
	 * `data.offline` is the strongest signal there is: the load actually tried
	 * to reach bordr and could not, and what is on screen is the held copy.
	 * navigator.onLine only knows about the interface.
	 */

	const watched = $derived(data.watched);
	const visibleMessages = $derived(detail.messages.slice(-shown));
	const hidden = $derived(Math.max(0, detail.messages.length - shown));
	const canShowEarlier = $derived(hidden > 0 || detail.hasMore);
	const toolCount = $derived(visibleMessages.reduce((n, m) => n + m.tools.length, 0));

	/**
	 * The transcript, with any still-unclaimed prompts after it.
	 *
	 * A queued prompt is NOT written to the transcript when you send it — the
	 * harness writes its file per turn, so it exists only on that pane's
	 * screen until the turn processes it.
	 *
	 * They go at the END, in the order they were sent. Slotting them by
	 * timestamp — after the last entry written before they were sent — put a
	 * queued prompt ABOVE the replies the agent went on to write, which reads
	 * as though it had already been answered. A queued prompt has not happened
	 * yet; the bottom of the transcript is where it belongs, and it moves into
	 * place on its own when the turn claims it.
	 */
	/**
	 * Where a bubble sits in a run of turns from the same speaker.
	 *
	 * Four consecutive replies from an agent are one piece of speech, not
	 * four separate shouts, so only the ends of a run get the full corner and
	 * only the last one gets a tail — the same rule every chat app uses.
	 */
	type RunPos = 'only' | 'first' | 'mid' | 'last';

	/** Preserve bubble joins when one turn has work between two bits of prose. */
	function bubbleRun(run: RunPos, segments: MessageSegment[], index: number): RunPos {
		const above =
			run === 'mid' ||
			run === 'last' ||
			segments.some((segment, i) => i < index && segment.kind === 'prose');
		const below =
			run === 'mid' ||
			run === 'first' ||
			segments.some((segment, i) => i > index && segment.kind === 'prose');
		return above && below ? 'mid' : above ? 'last' : below ? 'first' : 'only';
	}

	/**
	 * Pull a bubble up towards the one above it when they are the same run.
	 *
	 * The transcript lays every row out on one `gap-3`, which is right between
	 * turns and far too much inside one: four replies from the same agent are
	 * one piece of speech and were sitting as far apart as a question and its
	 * answer. Applied to the LOWER row of each pair, so only the joins tighten
	 * and the gap between speakers is untouched.
	 */
	function tight(run: RunPos): string {
		return run === 'mid' || run === 'last' ? '-mt-2' : '';
	}

	type Row =
		| { kind: 'message'; message: (typeof visibleMessages)[number]; key: string; run: RunPos }
		| { kind: 'pending'; sent: Pending; key: string; run: RunPos }
		| {
				kind: 'tools';
				blocks: Block[];
				turns: number;
				/** How many of each tool, commonest first — the folded row's whole point. */
				tally: { name: string; n: number }[];
				key: string;
				run: RunPos;
		  };

	/** Who is talking, for run detection. A queued prompt is always yours. */
	function speakerOf(row: Row): string {
		if (row.kind === 'pending') return 'user';
		if (row.kind === 'tools') return 'assistant';
		return row.message.role;
	}

	/** A turn that said nothing and only ran tools. Thinking stays visible. */
	function toolsOnly(row: Row): boolean {
		return (
			row.kind === 'message' &&
			row.message.role === 'assistant' &&
			prose(row.message).length === 0 &&
			onlyToolWork(row.message.blocks)
		);
	}

	/**
	 * Fold runs of tool-only turns into one row.
	 *
	 * Five greps in a row are one piece of work, not five things the agent
	 * said, and on a phone they push the actual reply off the screen. Off by
	 * default: watching the work happen is the point for some people, and this
	 * hides it behind a count.
	 *
	 * Only runs of two or more — collapsing a single call would add a row to
	 * open for no less scrolling.
	 */
	function groupTools(rows: Row[]): Row[] {
		if (!prefs.value.groupTools) return rows;
		const out: Row[] = [];
		for (let i = 0; i < rows.length; i++) {
			if (!toolsOnly(rows[i])) {
				out.push(rows[i]);
				continue;
			}
			let j = i;
			while (j + 1 < rows.length && toolsOnly(rows[j + 1])) j++;
			if (j === i) {
				out.push(rows[i]);
				continue;
			}
			const run = rows.slice(i, j + 1) as Extract<Row, { kind: 'message' }>[];
			const blocks = run.flatMap((r) => work(r.message));
			// Count by tool, commonest first. "12 tool calls" says how much was
			// hidden; "8 Bash · 3 Read · 1 Edit" says what it was, which is the
			// difference between deciding to open it and having to.
			// A plain record, not a Map: this is a local tally inside a pure
			// function, and the lint rule that pushes Map towards SvelteMap is
			// about reactive state, which this is not.
			const counts: Record<string, number> = {};
			for (const block of blocks) {
				if (block.kind !== 'tool') continue;
				counts[block.name] = (counts[block.name] ?? 0) + 1;
			}
			out.push({
				kind: 'tools',
				blocks,
				turns: run.length,
				tally: Object.entries(counts)
					.map(([name, n]) => ({ name, n }))
					.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
				key: `g${run[0].key}`,
				run: 'only'
			});
			i = j;
		}
		return out;
	}

	const rows = $derived.by((): Row[] => {
		const base = detail.messages.length - visibleMessages.length;
		const out: Row[] = visibleMessages.map((message, i) => ({
			kind: 'message' as const,
			message,
			key: `m${base + i}`,
			run: 'only' as RunPos
		}));
		// Slot each queued prompt where it was actually sent, not at the end.
		// Appending piled every unclaimed prompt below whatever the agent said
		// afterwards, so a question asked mid-turn ended up underneath the
		// answer to the one before it. `Message.at` exists for this.
		//
		// A transcript with no timestamps at all (an adapter that does not say)
		// leaves every comparison false and they append, exactly as before.
		for (const sent of [...pendingSends].sort((a, b) => a.at - b.at)) {
			const at = (row: Row) =>
				row.kind === 'message' ? (row.message.at ?? 0) : row.kind === 'pending' ? row.sent.at : 0;
			let i = out.findIndex((row) => at(row) > sent.at);
			if (i < 0) i = out.length;
			out.splice(i, 0, { kind: 'pending', sent, key: `p${sent.id}`, run: 'only' as RunPos });
		}

		// Second pass, once the list is whole: a row's place in its run depends
		// on both neighbours, which the map above cannot see.
		//
		// Only rows that actually DRAW a bubble take part. A turn that was
		// nothing but tool calls renders its work and no bubble at all, so
		// counting it would put the tail on the wrong message — and it is the
		// same agent still talking, so it must not break the run either.
		const drawn = out.filter(
			(row) => row.kind === 'pending' || (row.kind === 'message' && prose(row.message).length > 0)
		);
		for (let i = 0; i < drawn.length; i++) {
			const me = speakerOf(drawn[i]);
			const above = i > 0 && speakerOf(drawn[i - 1]) === me;
			const below = i < drawn.length - 1 && speakerOf(drawn[i + 1]) === me;
			drawn[i].run = above && below ? 'mid' : above ? 'last' : below ? 'first' : 'only';
		}
		return groupTools(out);
	});

	/**
	 * Prompts that herdr has accepted but the transcript has not caught up
	 * with yet.
	 *
	 * The harness writes its file when it starts the turn, which for a queued
	 * prompt is after whatever it is already doing — so a sent message could
	 * sit invisible for minutes and look like it never went. These are shown
	 * as your own message straight away, and retired the moment the real one
	 * appears.
	 */
	/**
	 * `sending` means the POST is still in flight, `queued` means herdr has it.
	 *
	 * The bubble appears on the first of those, not the second: on a phone the
	 * round trip is long enough that a tapped send looked like it had gone
	 * nowhere, and people tap again. Showing it immediately is only honest if
	 * a refusal takes it back, which `send()` does — the text returns to the
	 * composer and the error says why.
	 */
	type Pending = PendingSend;
	let pendingSends = $state<Pending[]>([]);
	let pendingSeq = 0;

	/**
	 * Queued prompts survive leaving the conversation.
	 *
	 * They used to be component state, so switching agent or reloading lost
	 * them — and a queued prompt is exactly the thing you leave the app and
	 * come back to check on. Stored per pane, because they belong to that
	 * agent's queue and nothing else.
	 */
	function pendingStorageKey(paneId: string): string {
		return `bordr-pending:${paneId}`;
	}

	const PENDING_KEY = $derived(pendingStorageKey(detail.paneId));
	/** A prompt still unclaimed after this long is not coming back. */
	const PENDING_TTL_MS = 6 * 60 * 60 * 1000;

	$effect(() => {
		// Re-runs when the pane changes, which is what makes switching agents
		// load that agent's queue rather than keeping the last one's.
		const key = PENDING_KEY;
		let restored: Pending[] = [];
		try {
			const raw = JSON.parse(localStorage.getItem(key) ?? '[]');
			const now = Date.now();
			if (Array.isArray(raw)) {
				restored = raw
					.filter(
						(p) => p && typeof p.text === 'string' && now - Number(p.at ?? 0) < PENDING_TTL_MS
					)
					// Nothing restored is still in flight — that request died with the
					// page. Anything stored was accepted, or it would not have persisted.
					.map((p) => ({ ...p, state: 'queued' as const }));
			}
		} catch {
			// Unreadable storage is not a reason to lose the conversation.
		}
		pendingSeq = restored.reduce((n, p) => Math.max(n, Number(p.id) || 0), 0);
		pendingSends = restored;
	});

	$effect(() => {
		const key = PENDING_KEY;
		const value = pendingSends;
		try {
			if (value.length === 0) localStorage.removeItem(key);
			else localStorage.setItem(key, JSON.stringify(value));
		} catch {
			// Private mode, or storage full. The echo still works in-session.
		}
	});

	/** Remove an optimistic send after its request failed on a pane now off-screen. */
	function removeStoredPending(paneId: string, id: number) {
		const key = pendingStorageKey(paneId);
		try {
			const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
			if (!Array.isArray(stored)) return;
			const kept = stored.filter((pending) => Number(pending?.id) !== id);
			if (kept.length > 0) localStorage.setItem(key, JSON.stringify(kept));
			else localStorage.removeItem(key);
		} catch {
			// Best effort, like the pending queue itself.
		}
	}

	$effect(() => {
		if (pendingSends.length === 0) return;

		/**
		 * What has actually landed in the transcript.
		 *
		 * Matched on text rather than order: a queued prompt can land after a
		 * later one, and the harness may rewrite the tail as it goes.
		 *
		 * A `!` command contributes NO text — its content is a tool block — so
		 * it has to be recovered from the block's own command, or every shell
		 * command sent from the phone stayed "queued" forever.
		 */
		/**
		 * Compared on words, not on bytes.
		 *
		 * A prompt is typed into a terminal on its way to the harness, and what
		 * comes back out is not always character-for-character what went in —
		 * a multi-line prompt in particular can land with its newlines turned
		 * into spaces. Exact matching meant those never retired: the bubble sat
		 * there saying "queued" for the rest of the session, long after the
		 * agent had read it and answered.
		 */

		// An array rather than a Set: this is a local scratch value, and the
		// lint rule that steers reactive state to SvelteSet cannot tell the
		// difference. There are only ever a handful of unsent prompts.
		const landed: string[] = [];
		for (const message of detail.messages) {
			if (message.role !== 'user') continue;
			if (say(message.text)) landed.push(say(message.text));
			for (const block of message.blocks ?? []) {
				if (block.kind !== 'tool' || block.name !== '!') continue;
				const command = say(String(block.input?.command ?? ''));
				if (command) landed.push(`!${command}`);
			}
		}

		// The rule itself is in $lib/pending-sends.ts, with its tests — it is the
		// one that lost messages, and it is easier to get wrong than it looks.
		const settled = detail.status === 'idle' || detail.status === 'done';
		const still = keepPending(pendingSends, landed, settled, Date.now());
		if (still.length !== pendingSends.length) pendingSends = still;
	});

	/**
	 * The list store, not a second raw EventSource: it already owns the
	 * reconnect logic, and its agent list is what swipe navigates through — so
	 * "next agent" always means the next one the list would show.
	 */
	const store = agentStore;
	/**
	 * Swiping walks the list as it is filtered, not as it would be unfiltered:
	 * "next" has to land on a row you could have tapped.
	 *
	 * A pane you opened before setting the filter can fall outside it. That is
	 * handled by `position`, which reports -1 and simply hides the counter,
	 * rather than by dropping the filter behind your back.
	 */
	const order = $derived(
		flatOrder(store.agents, prefs.value.groupBy, prefs.value.sort, prefs.value.listFilter)
	);
	const position = $derived(order.indexOf(detail.paneId));

	const speechSupported =
		typeof window !== 'undefined' &&
		('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

	/** Web Speech's error codes are not sentences; these are. */
	const DICTATION_ERRORS: Record<string, string> = {
		'not-allowed': 'Microphone permission was refused.',
		'service-not-allowed': 'Microphone permission was refused.',
		'no-speech': 'No speech heard.',
		network: 'Dictation needs a network connection.',
		'audio-capture': 'No microphone found.'
	};

	function stopDictation() {
		wantDictation = false;
		recognition?.stop();
		recognition = null;
		dictating = false;
		interim = '';
		releaseScreen();
	}

	function toggleDictation() {
		if (dictating) {
			stopDictation();
			return;
		}
		type RecognitionCtor = new () => {
			lang: string;
			interimResults: boolean;
			continuous: boolean;
			onresult: (e: {
				resultIndex: number;
				results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
			}) => void;
			onend: () => void;
			onerror: (event: { error?: string }) => void;
			start: () => void;
			stop: () => void;
		};
		const Ctor =
			(
				window as unknown as {
					SpeechRecognition?: RecognitionCtor;
					webkitSpeechRecognition?: RecognitionCtor;
				}
			).SpeechRecognition ??
			(window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;
		if (!Ctor) return;
		const r = new Ctor();
		r.lang = prefs.value.dictationLang;
		r.interimResults = true;
		// One utterance per engine session. Android's engine does not really
		// do continuous mode: it re-delivers the sentence so far, longer each
		// time and each copy marked final, so appending per event produced
		// "I'm I'm just I'm just testing…". The hold loop below restarts the
		// engine after each utterance, which is what "continuous" meant anyway.
		r.continuous = false;
		r.onresult = (e) => {
			// Rebuilt from the WHOLE result list every time, never appended;
			// see mergeResults for the Android shapes that made this necessary.
			const merged = mergeResults(dictationBase, e.results);
			draft = merged.draft;
			interim = merged.interim;
		};
		r.onend = () => {
			interim = '';
			// The engine ends itself after each utterance (and on every pause
			// on Android; there is no setting for it). While the person still
			// wants to dictate, fold what landed into the base and start it
			// again, unless it is ending so fast that restarting would spin.
			if (wantDictation && prefs.value.dictationHold) {
				quickEnds = Date.now() - dictationStartedAt < 1_000 ? quickEnds + 1 : 0;
				if (quickEnds < 3) {
					dictationBase = draft;
					dictationStartedAt = Date.now();
					try {
						r.start();
						return;
					} catch {
						// fall through: the engine refused a restart
					}
				}
				sendError = 'Dictation keeps stopping; the speech engine is not cooperating.';
			}
			dictating = false;
			recognition = null;
			wantDictation = false;
			releaseScreen();
		};
		r.onerror = (event) => {
			const code = event.error ?? 'unknown';
			// Silence is not a fault while holding: onend follows and restarts.
			if (code === 'no-speech' && wantDictation && prefs.value.dictationHold) return;
			// A deliberate stop reports 'aborted'; nothing to say about it.
			if (code === 'aborted' && !wantDictation) return;
			wantDictation = false;
			dictating = false;
			recognition = null;
			interim = '';
			releaseScreen();
			sendError = DICTATION_ERRORS[code] ?? `Dictation failed: ${code}.`;
		};
		recognition = r;
		wantDictation = true;
		dictating = true;
		quickEnds = 0;
		dictationBase = draft;
		dictationStartedAt = Date.now();
		r.start();
		void holdScreen();
	}

	function clearAttachments() {
		for (const url of previews) URL.revokeObjectURL(url);
		previews = [];
		attachments = [];
	}

	/** Photos still being shrunk; the send button waits for them. */
	let preparing = $state(0);

	/**
	 * A screenshot pasted straight into the box.
	 *
	 * Ctrl/Cmd-V with an image on the clipboard is how anyone on a desktop
	 * shares a screenshot, and reaching for the camera button to find a file
	 * they never saved is the wrong shape. Same path as the picker, so the
	 * shrink, the cap of six and the previews all apply unchanged.
	 */
	async function onPaste(event: ClipboardEvent) {
		const items = [...(event.clipboardData?.items ?? [])];
		const images = items
			.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
			.map((item) => item.getAsFile())
			.filter((file): file is File => file !== null);
		if (images.length === 0) return;
		// Only once there is definitely an image: otherwise this would eat a
		// perfectly ordinary text paste.
		event.preventDefault();
		await attach(images);
	}

	async function addFiles(input: HTMLInputElement) {
		const picked = [...(input.files ?? [])];
		// Cleared so the same photo can be picked again after a removal —
		// an unchanged selection fires no change event.
		input.value = '';
		await attach(picked);
	}

	/**
	 * Photos that arrived through the Android share sheet.
	 *
	 * /share stashed them and the agents list sent you here with their names.
	 * Fetched back through the uploads route and attached exactly as a picked
	 * or pasted photo would be, then the query is cleared so a reload does not
	 * attach them a second time.
	 */
	async function claimShared() {
		const names = (page.url.searchParams.get('shared') ?? '').split(',').filter(Boolean);
		if (names.length === 0) return;
		const text = page.url.searchParams.get('text') ?? '';
		const files: File[] = [];
		for (const name of names) {
			try {
				const res = await fetch(`/api/uploads/${encodeURIComponent(name)}`);
				if (!res.ok) continue;
				const blob = await res.blob();
				files.push(new File([blob], name, { type: blob.type }));
			} catch {
				// A pruned or unreadable share is not worth failing the page for.
			}
		}
		if (text && !draft) draft = text;
		if (files.length) await attach(files);
		await goto(resolve('/a/[pane]', { pane: detail.paneId }), {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	async function attach(files: File[]) {
		const picked = files.slice(0, 6 - attachments.length);
		// Shrunk on the phone: six camera photos were thirty megabytes, more
		// than the server's request cap and slow over the tailnet. One at a
		// time, not all at once: six full-size bitmaps decoded together is
		// hundreds of megabytes on a phone, and each thumbnail should appear
		// as it is ready rather than all of them after the last.
		preparing += picked.length;
		for (const file of picked) {
			try {
				const shrunk = await shrinkImage(file);
				attachments = [...attachments, shrunk];
				previews = [...previews, URL.createObjectURL(shrunk)];
			} catch (e) {
				sendError = `Could not read ${file.name || 'that image'}: ${(e as Error).message}`;
			} finally {
				preparing -= 1;
			}
		}
	}

	function removeAt(i: number) {
		URL.revokeObjectURL(previews[i]);
		previews = previews.filter((_, n) => n !== i);
		attachments = attachments.filter((_, n) => n !== i);
	}

	async function toggleWatch() {
		const response = await fetch(`/api/agents/${encodeURIComponent(detail.paneId)}/watch`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ watched: !watched })
		});
		// Re-read rather than assuming: the server owns this flag, and the reload
		// is what makes the pill reflect a rejected or concurrent change.
		if (response.ok) await invalidateAll();
	}

	/**
	 * Reveal older messages, widening the server's read window first when the
	 * buffer is exhausted. Two tiers behind one control: slicing what is already
	 * loaded is instant, and a 16MB transcript yields only ~70 messages in the
	 * default window — far short of the 80 first paint shows, so without the
	 * widening step the control could never appear at all on a long session.
	 */
	async function showEarlier() {
		if (hidden === 0 && detail.hasMore) {
			loadingEarlier = true;
			// Anchor on the distance from the BOTTOM: prepending older messages
			// grows the page upward, and holding scrollY would silently carry the
			// reader hundreds of messages away from where they were reading.
			const fromBottom = document.body.scrollHeight - window.scrollY;
			const next = Math.min(data.megabytes * 4, 64);
			const route = resolve('/a/[pane]', { pane: detail.paneId });
			// Still a resolved app path, just carrying the window — the cast keeps
			// no-navigation-without-resolve enforced everywhere else rather than
			// switching the rule off for the file.
			const target = `${route}?w=${next}` as typeof route;
			await goto(target, { replaceState: true, noScroll: true, keepFocus: true });
			await tick();
			window.scrollTo({ top: document.body.scrollHeight - fromBottom });
			loadingEarlier = false;
		}
		shown += 200;
	}

	/**
	 * Reaching the top loads more, rather than asking you to find a button.
	 *
	 * Watched with an IntersectionObserver against whatever is actually
	 * scrolling — the window on a phone, the column on the desktop — and with
	 * a margin, so the read starts before the reader hits the end rather than
	 * after. showEarlier anchors the scroll from the BOTTOM, so each load
	 * leaves the sentinel off screen again; it cannot run away with itself.
	 */
	// The parameter is the breakpoint, taken only so Svelte calls `update` when
	// it changes; the observer reads the new root itself.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	function autoEarlier(node: HTMLElement, wide?: boolean) {
		let observer: IntersectionObserver | null = null;
		const attach = () => {
			observer?.disconnect();
			observer = new IntersectionObserver(
				(entries) => {
					if (!entries.some((e) => e.isIntersecting)) return;
					if (loadingEarlier || !canShowEarlier) return;
					void showEarlier();
				},
				{ root: scrollHost(), rootMargin: '600px 0px 0px 0px' }
			);
			observer.observe(node);
		};
		attach();
		return {
			// The scroll root changes when the window crosses the breakpoint, and
			// an observer keeps the root it was made with.
			update: attach,
			destroy: () => observer?.disconnect()
		};
	}

	/**
	 * Whatever is actually scrolling.
	 *
	 * On the phone that is the window. On desktop the conversation column
	 * scrolls inside itself so the session tree can stay put — which silently
	 * broke stick-to-bottom, because `window.scrollY` never moves there.
	 */
	/**
	 * True while this conversation is the page on screen.
	 *
	 * A scroll queued here can land after you have left. `refresh()` awaits
	 * `invalidateAll()` and then asks for a frame; the burst schedules four
	 * more over two seconds. Navigate away in that window and the callback
	 * still runs — and by then `swipeRoot` is detached, so `scrollHost()`
	 * returns null and the fallback scrolls THE WINDOW, which now belongs to
	 * the agents list. The list ends up at the bottom, having never been
	 * touched by anyone.
	 */
	let live = true;

	function scrollHost(): HTMLElement | null {
		if (!swipeRoot || !swipeRoot.isConnected) return null;
		return getComputedStyle(swipeRoot).overflowY === 'auto' ? swipeRoot : null;
	}

	/**
	 * A scroll WE caused, which must not be read as the reader moving.
	 *
	 * Cleared a frame later: the scroll event lands after the assignment, and
	 * without the flag every automatic scroll looked like a deliberate one.
	 */
	let programmatic = false;

	function scrollBottom() {
		// Nothing to scroll, and the window is somebody else's now.
		if (!live) return;
		// Never under a finger. This is the choke point every automatic scroll
		// goes through, and guarding only the callers left one through:
		// `refresh()` decides whether to pin BEFORE it awaits the network, so a
		// refresh already in flight when the drag started still yanked once.
		// One yank is all it takes — you pull, it snaps back, you pull again.
		if (touching) return;
		const host = scrollHost();
		programmatic = true;
		if (host) host.scrollTop = host.scrollHeight;
		else window.scrollTo({ top: document.body.scrollHeight });
		requestAnimationFrame(() => (programmatic = false));
	}

	function scrollTop(): number {
		return scrollHost()?.scrollTop ?? window.scrollY;
	}

	/** Within `slack` pixels of the end. */
	function nearBottom(slack = 32): boolean {
		const host = scrollHost();
		if (host) return host.scrollTop + host.clientHeight >= host.scrollHeight - slack;
		return window.innerHeight + window.scrollY >= document.body.scrollHeight - slack;
	}

	/**
	 * Whether the reader is following the end.
	 *
	 * INTENT, not geometry. It used to be recomputed from the scroll position
	 * on every event, which made it wrong in both directions: the transcript
	 * growing moves the bottom away without the reader moving at all, so
	 * following flipped off by itself and the jump button appeared while you
	 * were sitting at the end — and the automatic scroll then put you back,
	 * which is the jitter.
	 *
	 * It now changes on two things only: scrolling UP turns it off, and
	 * arriving at the end turns it back on. Everything else — a poll, a new
	 * turn, the keyboard opening, the column being resized — leaves the
	 * reader's decision alone.
	 */
	let following = $state(true);
	let lastTop = 0;

	function onScroll() {
		const top = scrollTop();
		following = nextFollowing(following, {
			top,
			lastTop,
			atBottom: nearBottom(),
			programmatic
		});
		lastTop = top;
	}

	$effect(() => {
		const host = scrollHost();
		const target: HTMLElement | Window = host ?? window;
		target.addEventListener('scroll', onScroll, { passive: true });

		// `following` is geometry, and a scroll is only one of the things that
		// changes it. The mobile keyboard opening, a rotation, the desktop
		// column being resized and the transcript growing all move the bottom
		// without any scroll event — which left the Latest button showing while
		// already at the end, pointing at where you were.
		//
		// visualViewport as well as window: the soft keyboard resizes the
		// visual viewport and, on iOS, fires nothing on window at all.
		window.addEventListener('resize', onScroll);
		window.visualViewport?.addEventListener('resize', onScroll);
		// The transcript growing is what a new turn looks like to the DOM. While
		// following, that is the moment to stay at the end; while not, it must
		// change nothing at all.
		const observer = new ResizeObserver(() => {
			// Never while a finger is down. On a phone the address bar collapses
			// and expands as you drag, and each of those is a resize — so at the
			// end of a transcript, pulling the chat fired a scroll-to-bottom into
			// the middle of the gesture, over and over. The content fought the
			// thumb, which is the "bugs out" of it.
			if (following && !touching) scrollBottom();
			else if (!touching) onScroll();
		});
		if (swipeRoot) observer.observe(swipeRoot);

		onScroll();
		return () => {
			target.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			window.visualViewport?.removeEventListener('resize', onScroll);
			observer.disconnect();
		};
	});

	/** Refresh from the server; keep the view pinned to the bottom unless the
	 *  reader has deliberately scrolled up. */
	async function refresh() {
		// This page mounts before its route navigation settles. Starting an
		// invalidateAll here keeps that navigation open forever, so the global
		// loading bar never finishes. The event/poll path will refresh again.
		if (navigating.to) return;
		// Never yank the page out from under a copy: re-rendering destroys
		// an active selection, and lifting an error out of a transcript is
		// a core phone use.
		if ((window.getSelection()?.toString().length ?? 0) > 0) return;
		// `following`, not the geometry at this instant: a reader parked a
		// couple of hundred pixels up was inside the old 160px slack and got
		// dragged back down by the next poll.
		const pinned = following;
		await invalidateAll();
		if (pinned) requestAnimationFrame(scrollBottom);
	}

	onMount(() => {
		draftStore = createSessionDraftStore(localStorage);
		draftPaneId = detail.paneId;
		draft = draftStore.load(draftPaneId);
		const flushDraft = () => draftStore?.flush();
		addEventListener('pagehide', flushDraft);
		live = true;
		void claimShared();
		scrollBottom();
		store.start();
		document.addEventListener('visibilitychange', onVisibility);
		schedulePoll();
		return () => {
			// Before anything else: a frame already requested cannot be
			// cancelled from here, but it can be made harmless.
			live = false;
			store.stop();
			refreshGate.cancel();
			clearTimeout(poll);
			for (const timer of burst) clearTimeout(timer);
			draftStore?.flush();
			removeEventListener('pagehide', flushDraft);
			document.removeEventListener('visibilitychange', onVisibility);
			// Leaving mid-sentence must not keep the microphone open for a page
			// that no longer exists.
			stopDictation();
		};
	});

	// Any agent event may mean new transcript content or a status change.
	// Server-side coalescing already bounds the rate; this only stops a burst
	// of store updates turning into a burst of loads, without ever dropping
	// the last one.
	const refreshGate = throttleTrailing(() => void refresh(), 300);
	$effect(() => {
		void store.agents;
		refreshGate.call();
	});

	/**
	 * herdr sends no event for a dialog drawn in place — a slash-command menu
	 * on an idle pane, pi's question under "working" — and the list only
	 * changes when a state does. Only the screen shows it, so the open
	 * conversation is polled while the page is in front: every two seconds
	 * at rest, and in a quick burst after anything this page sent, which is
	 * exactly when a menu is about to paint.
	 */
	const POLL_MS = 2_000;
	const BURST_MS = [350, 800, 1_400, 2_200];
	let poll: ReturnType<typeof setTimeout> | undefined;
	let burst: ReturnType<typeof setTimeout>[] = [];

	/**
	 * The screen box follows its bottom edge, where the prompt and footer
	 * are, unless the reader has scrolled up inside it to look at something.
	 */
	let screenBox = $state<HTMLDivElement | undefined>();
	let screenPinned = true;
	function onScreenScroll() {
		if (!screenBox) return;
		screenPinned = screenBox.scrollTop + screenBox.clientHeight >= screenBox.scrollHeight - 24;
	}
	$effect(() => {
		void detail.screenTail;
		const box = screenBox;
		if (!box || !screenPinned) return;
		requestAnimationFrame(() => {
			box.scrollTop = box.scrollHeight;
		});
	});

	function schedulePoll() {
		clearTimeout(poll);
		poll = setTimeout(() => {
			if (document.visibilityState === 'visible') refreshGate.call();
			schedulePoll();
		}, POLL_MS);
	}

	// Switching to a different agent resets the tail and re-pins. Guarded by
	// VALUE, not object identity — every SSE refresh produces a new detail
	// object, and without the guard this effect yanked the reader to the
	// bottom on every poll while they were scrolled up reading history.
	let currentPane = $state('');
	$effect(() => {
		if (detail.paneId === currentPane) return;
		currentPane = detail.paneId;
		shown = TAIL;
		scrollback = null;
		following = true;
		requestAnimationFrame(scrollBottom);
	});

	/**
	 * Tell the server what has been seen. The inbox's unread dot reads the
	 * server's read-state, fanned out over SSE to every device, so a purely
	 * local record cleared nothing. Fire-and-forget: a lost mark only leaves
	 * a dot on until the next look.
	 */
	let marked: { paneId: string; seq: number } | null = null;
	function markRead() {
		if (document.visibilityState !== 'visible') return;
		const { paneId, seq } = detail;
		if (marked?.paneId === paneId && marked.seq >= seq) return;
		marked = { paneId, seq };
		fetch('/api/read-state', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ paneId, seq })
		})
			.then((response) => {
				if (!response.ok) console.warn(`read-state refused: ${response.status}`);
			})
			.catch((e: unknown) => console.warn('read-state failed', e));
	}

	// On arrival, and again each time the pane's seq advances while the page
	// is in front; a seq that moved while the phone was locked is caught by
	// the visibilitychange listener instead.
	$effect(() => {
		void detail.paneId;
		void detail.seq;
		markRead();
	});

	/** The server's `{message}` for a failed call, or a status-bearing fallback. */
	async function failure(response: Response, what: string): Promise<Error> {
		const body = (await response.json().catch(() => null)) as { message?: string } | null;
		return new Error(body?.message ?? `${what} failed: ${response.status}`);
	}

	/** Snapshot-rendered agents have no transcript to page through — pull
	 *  more of the terminal's own scrollback instead of showing one screen. */
	async function loadScrollback(lines: number) {
		loadingBack = true;
		scrollbackError = null;
		try {
			const r = await fetch(
				`/api/agents/${encodeURIComponent(detail.paneId)}/read?lines=${lines}&ansi=1`
			);
			if (!r.ok) throw await failure(r, 'read');
			const body: unknown = await r.json();
			const text =
				typeof body === 'object' && body !== null && 'text' in body ? body.text : undefined;
			if (typeof text !== 'string') throw new Error('the read endpoint sent no text');
			scrollback = text;
			scrollbackLines = lines;
		} catch (e) {
			// Whatever was on screen stays; say why nothing changed.
			scrollbackError = (e as Error).message;
		}
		loadingBack = false;
	}

	/** Something was just sent: a menu, a follow-up dialogue (Claude's
	 *  cache-invalidation confirm) or a reply is about to paint, and no
	 *  event will announce it — look now and a few more times shortly after. */
	function refreshSoon() {
		for (const timer of burst) clearTimeout(timer);
		refreshGate.call();
		burst = BURST_MS.map((ms) => setTimeout(() => refreshGate.call(), ms));
	}

	async function answer(index: number) {
		if (busy) return;
		busy = true;
		sendingIndex = index;
		uncertain = null;

		/**
		 * An answer is a turn you took, so it becomes a bubble like anything
		 * else you send.
		 *
		 * Without it, answering was the one action in the app that left no
		 * trace: the card vanished the moment the server confirmed it, and
		 * until the harness wrote the selection into its transcript — which can
		 * be a while — there was nothing on screen saying what you had chosen,
		 * or that you had chosen at all.
		 *
		 * The same row the composer uses, so it carries the same ticks and
		 * retires the same way: on the transcript showing it, or on the grace
		 * period once the agent settles.
		 */
		const chose = detail.picker?.options.find((o) => o.index === index);
		const echo = ++pendingSeq;
		pendingSends = [
			...pendingSends,
			{
				id: echo,
				text: chose?.label ?? String(index),
				question: detail.picker?.question ?? '',
				at: Date.now(),
				state: 'sending'
			}
		];
		requestAnimationFrame(scrollBottom);

		try {
			const r = await track(() =>
				fetch(`/api/agents/${encodeURIComponent(detail.paneId)}/answer`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ index })
				})
			);
			const body = (await r.json().catch(() => null)) as {
				outcome?: string;
				chose?: string;
				message?: string;
			} | null;
			// Never silently pretend: if the screen did not confirm the
			// selection, say so and let the user look — do not auto-retry,
			// which could answer twice. A refusal ("option 4 is not on
			// screen") is different again and carries the server's reason.
			if (!r.ok) {
				// Refused: take the echo back, or the screen would claim an answer
				// that never left.
				pendingSends = pendingSends.filter((p) => p.id !== echo);
				uncertain = body?.message ?? `Could not answer (${r.status}).`;
			} else if (body?.outcome === 'unknown') {
				// Sent, but unconfirmed. The echo stays — something did leave —
				// and the warning says it could not be verified.
				pendingSends = pendingSends.map((p) =>
					p.id === echo ? { ...p, state: 'queued' as const, deliveredAt: Date.now() } : p
				);
				uncertain = `Sent "${body.chose}" but could not confirm it landed — check before sending again.`;
			} else {
				pendingSends = pendingSends.map((p) =>
					p.id === echo ? { ...p, state: 'queued' as const, deliveredAt: Date.now() } : p
				);
				// The server checked the screen and the menu moved. Retire the card
				// now rather than letting it sit there looking unanswered until the
				// next read catches up.
				answeredKey = pickerKey;
				answeredAt = Date.now();
				now = answeredAt;
			}
		} catch (e) {
			pendingSends = pendingSends.filter((p) => p.id !== echo);
			uncertain = `Nothing was sent: ${(e as Error).message}. Check the connection and try again.`;
		} finally {
			busy = false;
			sendingIndex = -1;
		}
		refreshSoon();
	}

	/** Resolves to whether herdr took the keys; a refusal shows up as `sendError`. */
	async function sendKeys(keys: string[]): Promise<boolean> {
		sendError = null;
		try {
			const r = await track(() =>
				fetch(`/api/agents/${encodeURIComponent(detail.paneId)}/keys`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ keys })
				})
			);
			if (!r.ok) throw await failure(r, 'keys');
			return true;
		} catch (e) {
			sendError = (e as Error).message;
			return false;
		} finally {
			refreshSoon();
		}
	}

	const KEY_STRIP: Array<{ k: string; l: string }> = [
		{ k: 'esc', l: 'esc' },
		{ k: 'tab', l: 'tab' },
		// The harness's own mode switch. Claude Code cycles auto-accept and
		// plan behind Shift+Tab and says so in its status line; there was no
		// way to reach it from a phone at all.
		{ k: 'shift+tab', l: '⇧⇥' },
		{ k: 'up', l: '↑' },
		{ k: 'down', l: '↓' },
		{ k: 'left', l: '←' },
		{ k: 'right', l: '→' },
		{ k: 'space', l: '␣' },
		{ k: 'enter', l: '⏎' }
	];

	function tapKey(key: string) {
		// The flash and buzz are press feedback, so they stay immediate; a key
		// herdr refuses then shows up as the inline error rather than as silence.
		navigator.vibrate?.(30);
		flashKey = key;
		setTimeout(() => (flashKey = ''), 120);
		void sendKeys([key]);
	}

	const TOO_LARGE =
		"Too large for the server's request limit. Raise BODY_SIZE_LIMIT in .env (README) or send fewer photos.";

	/**
	 * What the composer just typed into a question, so the hint can say so.
	 * Cleared on the next send or when the question goes.
	 */
	let typedInto = $state(false);

	/**
	 * Your own words, into a question that is on screen.
	 *
	 * herdr refuses `agent.prompt` while a pane is blocked — rightly: a prompt
	 * is a whole new turn, and the harness is sitting on a keystroke. So the
	 * composer already offered "Or type a reply…" and then failed with
	 * "agent w3:p1 is blocked and requires interactive input", which is a
	 * promise the code did not keep.
	 *
	 * It now types the characters into the pane, exactly as a keyboard would,
	 * and stops there. Enter is deliberately NOT sent: inside somebody else's
	 * picker, Enter means "take the highlighted option", so pressing it after
	 * typing would answer something other than what was typed. The key strip
	 * has ⏎ for when it looks right — and the harness's own footer says what
	 * else is available, Claude Code's `n to add notes` among them.
	 */
	async function typeIntoQuestion(paneId: string, text: string): Promise<boolean> {
		try {
			const sent = await track(() =>
				fetch(`/api/agents/${encodeURIComponent(paneId)}/type`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text })
				})
			);
			if (!sent.ok) throw await failure(sent, 'type');
			return true;
		} catch (e) {
			sendError = (e as Error).message;
			return false;
		}
	}

	async function send() {
		if (!draft.trim() && attachments.length === 0) return;
		const paneId = detail.paneId;
		// Sending ends dictation: a still-listening engine would otherwise keep
		// writing the next sentence into the emptied composer. The mic is one
		// tap away if there is more to say.
		if (dictating) stopDictation();
		busy = true;
		sendError = null;
		typedInto = false;

		// A question is on screen: these are keystrokes, not a turn. No
		// optimistic bubble either — nothing has been said yet.
		if (detail.picker && attachments.length === 0) {
			const text = draft;
			const typed = await typeIntoQuestion(paneId, text);
			if (typed && detail.paneId === paneId) {
				draftStore?.clear(paneId);
				draft = '';
				typedInto = true;
			}
			busy = false;
			refreshSoon();
			return;
		}

		// Echo before the request, not after it. The composer empties and the
		// bubble appears on the tap; if the send is refused, both are put back
		// exactly as they were.
		const text = draft;
		const optimistic = text.trim() ? ++pendingSeq : 0;
		if (optimistic) {
			pendingSends = [...pendingSends, { id: optimistic, text, at: Date.now(), state: 'sending' }];
			draftStore?.clear(paneId);
			draft = '';
			following = true;
			requestAnimationFrame(scrollBottom);
		}

		try {
			if (attachments.length > 0) {
				const form = new FormData();
				for (const file of attachments) form.append('file', file);
				form.append('text', text);
				let sent: Response;
				try {
					sent = await fetch(`/api/agents/${encodeURIComponent(paneId)}/image`, {
						method: 'POST',
						body: form
					});
				} catch {
					// The adapter drops an oversize body before SvelteKit runs, which
					// the browser reports as a failed fetch rather than a status. A
					// small upload failing the same way is the connection, not the cap.
					const bytes = attachments.reduce((sum, file) => sum + file.size, 0);
					if (!navigator.onLine || bytes < 512 * 1024) {
						throw new Error('Upload failed before the server answered. Check the connection.');
					}
					throw new Error(TOO_LARGE);
				}
				// Same reason there is no JSON body to read on a 413.
				if (sent.status === 413) throw new Error(TOO_LARGE);
				if (!sent.ok) throw await failure(sent, 'upload');
				clearAttachments();
			} else {
				const sent = await fetch(`/api/agents/${encodeURIComponent(paneId)}/prompt`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text })
				});
				if (!sent.ok) throw await failure(sent, 'send');
			}
			// Delivered: the bubble stops pulsing and becomes a queued prompt,
			// which is what survives a reload.
			if (optimistic && detail.paneId === paneId) {
				pendingSends = pendingSends.map((p) =>
					p.id === optimistic ? { ...p, state: 'queued' as const, deliveredAt: Date.now() } : p
				);
			}
		} catch (e) {
			if (optimistic) {
				removeStoredPending(paneId, optimistic);
				const restored = draftStore?.restore(paneId, text) ?? text;
				if (detail.paneId === paneId) {
					sendError = (e as Error).message;
					pendingSends = pendingSends.filter((p) => p.id !== optimistic);
					draft = restored;
				}
			} else if (detail.paneId === paneId) {
				sendError = (e as Error).message;
			}
		}
		busy = false;
		await invalidateAll();
		if (following) requestAnimationFrame(scrollBottom);
		refreshSoon();
	}

	/**
	 * Enter inserts a newline by default and the modifier sends; the pref
	 * flips which is which. A multi-line prompt is the common case on a phone,
	 * so losing the newline key to "send" would be the worse default.
	 */
	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter') return;
		const modifier = event.metaKey || event.ctrlKey;
		const shouldSend = prefs.value.enterSends ? !event.shiftKey && !modifier : modifier;
		if (!shouldSend) return;
		event.preventDefault();
		void send();
	}

	async function stop() {
		if (stopping) return;
		stopping = true;
		try {
			await sendKeys(['esc']);
		} finally {
			stopping = false;
		}
	}

	// --- swipe between agents -------------------------------------------------
	let swipeRoot: HTMLElement | undefined;
	let startX = 0;
	let startY = 0;
	let tracking = false;

	/**
	 * Listeners are attached imperatively rather than as `ontouchstart` on the
	 * element: a plain <div> carrying touch handlers is an a11y violation, and
	 * these can be passive, which keeps them off the scroll critical path.
	 */
	$effect(() => {
		const root = swipeRoot;
		if (!root) return;
		root.addEventListener('touchstart', onTouchStart, { passive: true });
		root.addEventListener('touchmove', onTouchMove, { passive: true });
		root.addEventListener('touchend', onTouchEnd, { passive: true });
		// The system can take a gesture away — the back swipe, a notification
		// pulled down — and that never reaches touchend. Without this the flag
		// stayed set and the transcript stopped following for good.
		root.addEventListener('touchcancel', onTouchCancel, { passive: true });
		return () => {
			root.removeEventListener('touchstart', onTouchStart);
			root.removeEventListener('touchmove', onTouchMove);
			root.removeEventListener('touchend', onTouchEnd);
			root.removeEventListener('touchcancel', onTouchCancel);
		};
	});

	/**
	 * The panes of the current workspace's tabs, reported by the tab bar.
	 *
	 * A swipe walks the current tab's panes and then carries on into the rest
	 * of the fleet. Tabs used to REPLACE the list rather than sit inside it,
	 * which made a multi-pane tab a cul-de-sac: nothing outside it could be
	 * reached by the gesture at all. `swipeSequence` weaves the two together.
	 */
	let tabSiblings = $state<string[]>([]);
	const swipeOrder = $derived(swipeSequence(order, tabSiblings, detail.paneId));

	/**
	 * The pane a swipe is currently heading towards, as a card under this one.
	 *
	 * From the list the app already has, not a fetch: a title, a harness and a
	 * status are enough to know whether this is the one you meant before you
	 * let go of it. Null until a drag has a direction.
	 */
	const revealing = $derived.by(() => {
		if (!dragging || Math.abs(dragX) < 4) return null;
		const to = neighbourPane(swipeOrder, detail.paneId, dragX < 0 ? 'next' : 'previous');
		if (!to || to === detail.paneId) return null;
		return (
			store.agents.find((a) => a.paneId === to) ?? {
				paneId: to,
				title: to,
				agent: '',
				status: 'unknown' as AgentStatus
			}
		);
	});

	/**
	 * How far the transcript is dragged, in px, while a finger is down.
	 *
	 * The content follows at a third of the distance: enough that the gesture
	 * is clearly doing something, damped enough that it reads as resistance
	 * rather than as the page coming loose. Null means no gesture is running
	 * and the transition can take over.
	 */
	let dragX = $state(0);
	let dragging = $state(false);
	let leaving = $state(false);

	/**
	 * A finger is on the transcript.
	 *
	 * Set for ANY touch, not only a tracked swipe: the point is to keep the
	 * automatic scroll off the screen while somebody is moving it by hand,
	 * whatever they turn out to be doing.
	 */
	let touching = $state(false);

	function onTouchStart(event: TouchEvent) {
		touching = true;
		const touch = event.touches[0];
		if (!touch || event.touches.length > 1 || !prefs.value.swipeAgents) {
			tracking = false;
			return;
		}
		// A tool block or the screen peek scrolls sideways; it owns the gesture.
		tracking = !(swipeRoot && inHorizontalScroller(event.target, swipeRoot));
		startX = touch.clientX;
		startY = touch.clientY;
		dragX = 0;
		leaving = false;
	}

	function onTouchMove(event: TouchEvent) {
		if (!tracking) return;
		const touch = event.touches[0];
		if (!touch) return;
		const dx = touch.clientX - startX;
		const dy = touch.clientY - startY;
		// Only follow once the gesture has committed to being horizontal, or
		// every scroll down a long transcript would wobble the page sideways.
		if (!dragging && (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5)) return;
		dragging = true;
		// Two thirds where there IS somewhere to go, a third where there is not.
		//
		// The damping was resistance — "this moves, but not freely". That is the
		// right feel at the end of the deck, where the gesture cannot do
		// anything; it is the wrong one in the middle, where the drag has to
		// open a gap wide enough to actually read the card underneath before
		// deciding to let go.
		const reachable = neighbourPane(swipeOrder, detail.paneId, dx < 0 ? 'next' : 'previous');
		dragX = dx * (reachable && reachable !== detail.paneId ? 0.66 : 0.33);
	}

	function onTouchCancel() {
		touching = false;
		dragging = false;
		dragX = 0;
	}

	async function onTouchEnd(event: TouchEvent) {
		// Cleared here rather than after the swipe work below, which awaits: a
		// gesture that navigates must not leave the next page thinking a finger
		// is still down.
		touching = false;
		const wasDragging = dragging;
		dragging = false;
		if (!tracking) {
			dragX = 0;
			return;
		}
		tracking = false;
		const touch = event.changedTouches[0];
		if (!touch) {
			dragX = 0;
			return;
		}
		const direction = decideSwipe(
			touch.clientX - startX,
			touch.clientY - startY,
			startX,
			window.innerWidth
		);
		const pane = direction ? neighbourPane(swipeOrder, detail.paneId, direction) : null;
		if (!pane) {
			// Nowhere to go: spring back, which is the answer to "what did that
			// do?" — better than the content simply snapping straight.
			dragX = 0;
			return;
		}
		navigator.vibrate?.(20);
		if (wasDragging) {
			// Carry the drag off the edge it was heading for, then land the new
			// pane from the other side. Without this the content jumped from
			// wherever the finger left it back to centre, which read as a glitch.
			leaving = true;
			dragX = direction === 'next' ? window.innerWidth : -window.innerWidth;
			await new Promise((r) => setTimeout(r, 140));
		}
		// REPLACE, never push: swiping is moving along one list, not walking
		// deeper into it. Pushing meant that after five swipes the phone's back
		// gesture had to retrace all five before the agent list reappeared.
		// Back now always returns to where you came from; left swipe is how you
		// go to the previous agent.
		await goto(resolve('/a/[pane]', { pane }), { replaceState: true });
		// Land from the opposite edge, then release to centre on the next frame.
		dragX = direction === 'next' ? -window.innerWidth / 3 : window.innerWidth / 3;
		leaving = false;
		requestAnimationFrame(() => requestAnimationFrame(() => (dragX = 0)));
	}
</script>

{#snippet uncertainBanner()}
	{#if uncertain}
		<p
			role="status"
			class="mb-3 flex items-start gap-2 rounded-[10px] border border-blocked-edge bg-blocked-surface px-3 py-2.5 text-[12.5px] text-blocked-ink"
		>
			<span class="font-mono" aria-hidden="true">!</span>
			<span class="min-w-0 flex-1">{uncertain}</span>
			<button class="shrink-0 underline" onclick={() => (uncertain = null)}>Dismiss</button>
		</p>
	{/if}
{/snippet}

{#snippet errorBanner()}
	{#if sendError}
		<p
			role="status"
			class="mb-2 rounded-[10px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger-ink"
		>
			{sendError}
		</p>
	{/if}
{/snippet}

<svelte:head><title>{detail.title || detail.paneId} · bordr</title></svelte:head>

{#snippet headerTitle()}
	<span class="block truncate text-[15px] font-semibold">{detail.title || detail.paneId}</span>
	<!--
		Two rows, not one wrapping one: WHAT this pane is, then WHERE it is.

		One line could not hold both. Truncating it dropped whatever came last —
		the workspace and the 3/14 position simply vanished. Letting it wrap
		instead put the position on a third line whenever the branch was long,
		so the height moved about as you walked between panes. Splitting it by
		meaning is stable at two rows and each row has the full width to itself.
	-->
	<!--
		Clipped, not pushed. Every chip on this row is short and is `shrink-0`
		because none of them reads truncated — so when the row finally runs out
		of width, something has to give, and it is the row rather than the page.
		Without this the header pushed the whole document sideways the moment
		anything else joined the left of it.
	-->
	<span
		class="flex min-w-0 items-center gap-x-1 overflow-hidden font-mono text-[10.5px] text-muted"
	>
		<StatusMark status={detail.status} size={10} />
		{#if prefs.value.statusIndicators !== 'text'}
			<span class="shrink-0 {STATUS_INK[detail.status] ?? 'text-faint'}">{detail.status}</span>
		{/if}
		<span class="shrink-0 text-faint">·</span>
		<!--
			The mark alone when marks are on. Spelling "claude" out cost 60px of a
			178px row on a phone — a third of it — to repeat what the mark beside
			it and the title above it both already say.
		-->
		<span class="shrink-0 {harnessText(detail.agent)}"
			>{#if prefs.value.harnessIcons}<HarnessMark
					agent={detail.agent}
				/>{:else}{detail.agent}{/if}</span
		>
		{#if detail.workspaceLabel}
			<span class="shrink-0 text-faint">·</span>
			<span class="truncate">{detail.workspaceLabel}</span>
		{/if}
		{#if position >= 0 && order.length > 1}
			<span class="shrink-0 text-faint">·</span>
			<span class="shrink-0">{position + 1}/{order.length}</span>
		{/if}
	</span>
{/snippet}

<!--
	Where the work is, on its own full-width row.

	It cannot live in `middle`: that column is squeezed between the brand and
	the actions and measures about 178px on a phone, which truncated the branch
	to `feat/rich-tra…`. The caller passes this only when there is something to
	say, so a shell pane outside a repository keeps a single-line header rather
	than growing an empty row.
-->
{#snippet headerLocation()}
	<!-- Clips rather than pushing the page, same as the row above it. -->
	<span class="flex min-w-0 items-center gap-x-1 overflow-hidden font-mono text-[10.5px]">
		{#if modelLine.model}
			<!--
				First on the row, and it keeps its width. The path and the branch
				can be recognised cut short; "Opus" is a different model from
				"Opus 5", so this one cannot.
			-->
			<span class="shrink-0 text-working">{modelLine.model}</span>
			{#if modelLine.effort}
				<span class="shrink-0 text-faint">{modelLine.effort}</span>
			{/if}
			<span class="shrink-0 text-faint">·</span>
		{/if}
		{#if detail.cwd}
			<!--
				The path is short after collapseHome and is the half you orient
				by, so it keeps its width and the branch gives way first. max-w
				still catches a pathological one rather than letting it push the
				branch off the row entirely.
			-->
			<span class="max-w-[60%] shrink-0 truncate text-path" title={detail.cwd}
				>{collapseHome(detail.cwd)}</span
			>
		{/if}
		{#if detail.branch}
			{#if detail.cwd}<span class="shrink-0 text-faint">·</span>{/if}
			<!--
				The name and the arrows are one thing, so they are one target: at
				10.5px the branch alone is a thin thing to hit with a thumb, and
				the counts are what you are usually chasing when you tap it.
			-->
			{#snippet gitState()}
				<!-- min-w-0 is what lets a flex item shrink below its own text at all. -->
				<span class="min-w-0 truncate text-branch">&#xe0a0; {detail.branch}</span>
				<!-- The counts never truncate: a half-shown ↑1 would read as ↑ nothing. -->
				{#if detail.ahead}<span class="shrink-0 text-muted">&uarr;{detail.ahead}</span>{/if}
				{#if detail.behind}<span class="shrink-0 text-muted">&darr;{detail.behind}</span>{/if}
			{/snippet}
			{#if detail.branchUrl}
				<!--
					A new tab, not this one: bordr is installed to the home screen,
					and navigating it away to GitHub leaves no way back to the
					agent you were reading.
				-->
				<a
					class="flex min-w-0 items-center gap-x-1 underline decoration-branch/40 decoration-dotted underline-offset-[3px] active:decoration-branch"
					href={detail.branchUrl}
					target="_blank"
					rel="noopener noreferrer"
					title="{detail.branch} on GitHub">{@render gitState()}</a
				>
			{:else}
				<span class="flex min-w-0 items-center gap-x-1" title={detail.branch}
					>{@render gitState()}</span
				>
			{/if}
		{/if}
	</span>
{/snippet}

{#snippet headerActions()}
	<!--
		The work switch, when it has been moved off the transcript. Up here it is
		a state you set once, rather than a link you re-find at the bottom of a
		growing conversation.
	-->
	{#if prefs.value.workControl === 'header' && toolCount > 0}
		<button
			class="flex h-9 shrink-0 items-center rounded-full border px-3 text-[12px] {showWork
				? 'border-working-halo bg-working-bg text-working'
				: 'border-edge text-muted'}"
			aria-pressed={showWork}
			onclick={() => {
				showWork = !showWork;
				prefs.set('showWork', showWork);
			}}
		>
			work {toolCount}
		</button>
	{/if}
	{#if detail.status === 'working'}
		<button
			class="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-edge px-3 text-[13px] font-medium disabled:opacity-50"
			disabled={stopping}
			onclick={stop}
		>
			{#if stopping}
				<Spinner size={12} label="Stopping" />
			{:else}
				<span
					class="h-2 w-2 rounded-full bg-working ring-[3px] ring-working-halo"
					aria-hidden="true"
				></span>
			{/if}
			Stop
		</button>
	{/if}
	<!--
		herdr's own controls for this pane and its tab: put it on the
		terminal's screen, name it, close it. Everything bordr drove until
		now was the AGENT — the workspace around it was read-only.
	-->
	<button
		class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-edge text-faint"
		aria-label="Pane and tab controls"
		onclick={() => (controlling = true)}
	>
		<span class="text-[17px] leading-none">&#x22EF;</span>
	</button>
	<button
		class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border {watched
			? 'border-blocked-edge bg-blocked-bg text-blocked-ink'
			: 'border-edge text-faint'}"
		aria-label={watched ? 'Stop notifying on done' : 'Notify on every done'}
		aria-pressed={watched}
		onclick={toggleWatch}
	>
		<Icon name="bell" size={17} />
	</button>
{/snippet}

{#snippet conversation()}
	<div
		class="flex min-h-dvh flex-col lg:h-full lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
		bind:this={swipeRoot}
	>
		<header class="sticky top-0 z-10 border-b border-hairline bg-page">
			{#if !wideScreen}
				{@render paneHeader()}
			{/if}

			<!--
				The pane strip is what the split itself already is, so it appears
				only where the split is not being drawn.
			-->
			{#if showChrome(prefs.value.tabStrip, touchPoints())}
				<WorkspaceTabs
					current={detail.paneId}
					panes={!(wideScreen && splitLayout)}
					onsiblings={(list) => (tabSiblings = list)}
				/>
			{/if}

			<!--
				Sub-agents this session has spawned.
				
				A Task call used to say an agent had been dispatched and nothing
				more — whether it was still going, what it found, whether it
				failed, none of it was reachable. Each has its own transcript, so
				each of these opens one.
			-->
			<!--
				Only while something is WORKING. A row that exists to say "+4 done"
				is 37px of a 179px header spent on a count — measured on a phone,
				where the header was already 22% of the screen. The finished ones
				move to the controls sheet, which is where things you might want
				rather than things happening now belong.
			-->
			{#if running.length > 0}
				<div class="flex items-center gap-1.5 overflow-x-auto border-b border-hairline px-2 py-1.5">
					<span class="shrink-0 font-mono text-[10px] tracking-[.06em] text-faint uppercase"
						>agents</span
					>
					{#each shownSubs as sub (sub.id)}
						<button
							class="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors hover:bg-chip {sub.done
								? 'border-hairline opacity-60'
								: 'border-edge'}"
							onclick={() => (openSub = sub.id)}
							title={sub.description || sub.agentType}
						>
							<!--
								A running agent is marked as one. Without it the only difference
								between working and long finished was an entry count that stops
								moving, which you have to watch to notice.
							-->
							{#if !sub.done}<Spinner size={11} label="running" />{/if}
							<span class="font-mono {sub.done ? 'text-muted' : 'text-working'}"
								>{sub.agentType}</span
							>
							<span class="max-w-[9rem] truncate text-muted">{sub.description}</span>
							<span class="font-mono text-[10px] text-faint">{sub.entries}</span>
						</button>
					{/each}
					{#if finished.length > 0 && strip !== 'all'}
						<button
							class="shrink-0 rounded-full px-2 py-1 font-mono text-[10.5px] text-faint"
							onclick={() => (showFinished = !showFinished)}
							aria-expanded={showFinished}
						>
							{showFinished ? 'hide' : `+${finished.length} done`}
						</button>
					{/if}
				</div>
			{/if}

			<!--
				Terminal mode lifts the footer off the screen itself, so the page's
				own copy would be the same rows twice.
			-->
			{#if detail.statusLines.length > 0 && prefs.value.statusPosition === 'header' && !terminalView}
				<StatusBlock
					rows={statusRows}
					agent={detail.agent}
					open={statusOpen}
					ontoggle={() => (statusOpen = !statusOpen)}
				/>
			{/if}
		</header>

		{#if terminalView}
			<!--
				Both banners render here as well as in the transcript view. They
				used to live only in the {:else} branch, so in terminal mode a
				refused keypress (409/503) and "sent but could not confirm it
				landed" were both invisible — the screen simply did not respond.
			-->
			<div class="mx-auto w-full max-w-screen-sm px-4 pt-3 lg:max-w-3xl">
				{@render uncertainBanner()}
				{@render errorBanner()}
			</div>
			<!--
				Terminal mode: the pane exactly as the machine draws it, with a
				prompt line under it. The transcript view is the one that
				interprets; this one shows.
			-->
			<PaneTerminal
				paneId={detail.paneId}
				agent={detail.agent}
				ask={detail.picker && detail.picker.options.length > 0 && !askHidden
					? pickerCard
					: undefined}
				suggestion={detail.suggestion ?? ''}
				bind:draft
				mono={prefs.value.monoSize}
				{dictating}
				{busy}
				onkeys={(keys) => void sendKeys(keys)}
				onmic={speechSupported ? toggleDictation : undefined}
			/>
		{:else}
			<!--
				The TRANSCRIPT moves, not the scroll container: the header above is
				`sticky` inside that container, and a transform on an ancestor of a
				sticky element makes it a containing block and the stickiness stops
				working. Moving only this leaves the header and the composer put,
				which also reads better — the chrome stays and the content slides
				under it.
			-->
			{#if revealing}
				<!--
					The pane the swipe is heading for, showing through the gap the
					transcript leaves as it slides — a card under the top of the deck
					rather than a screen that arrives with no warning.

					Sized to the gap, not to itself. A fixed-width card is mostly BEHIND
					the transcript for the first half of the drag, so the only part
					visible is whatever happens to be right-aligned in it — measured at
					a 145px gap: the title hidden, the word "idle" showing on its own.
					Growing with the gap means the whole of it is always readable, and
					the card widens as the deck opens, which is what a deck does.

					`pointer-events-none` because the finger is on the transcript above
					it: this is scenery, not a target.
				-->
				<div
					class="pointer-events-none fixed top-1/2 z-0 -translate-y-1/2 {dragX < 0
						? 'right-2'
						: 'left-2'}"
					style="width:{Math.min(260, Math.max(0, Math.abs(dragX) - 16))}px; opacity:{Math.min(
						1,
						Math.abs(dragX) / 70
					)}"
					aria-hidden="true"
				>
					<span class="block rounded-xl border border-edge bg-card px-3 py-2.5 shadow-lg">
						<span class="flex items-baseline gap-2">
							<span class="min-w-0 flex-1 truncate text-[14px] font-medium"
								>{agentTitle(revealing.title, '', revealing.paneId, revealing.agent)}</span
							>
							<span
								class="shrink-0 font-mono text-[10px] {STATUS_INK[revealing.status] ??
									'text-faint'}">{revealing.status}</span
							>
						</span>
						{#if revealing.agent}
							<span
								class="mt-0.5 block truncate font-mono text-[11px] {harnessText(revealing.agent)}"
								>{revealing.agent}</span
							>
						{/if}
					</span>
				</div>
			{/if}
			<main
				class="relative mx-auto w-full max-w-screen-sm flex-1 px-4 pt-3 pb-2 lg:mx-0 lg:max-w-3xl lg:px-6 xl:max-w-4xl 2xl:max-w-5xl {dragging
					? 'bg-page'
					: ''} {dragging || leaving
					? ''
					: 'transition-transform duration-200 ease-out motion-reduce:transition-none'} {leaving
					? 'transition-all duration-150 ease-in'
					: ''}"
				style="transform: translate3d({dragX}px, 0, 0); {leaving ? 'opacity:0' : ''}"
				data-swiping={dragging ? 'true' : undefined}
			>
				{#if detail.degraded !== 'none'}
					<p class="mb-3 flex items-center gap-2 text-[12px] text-muted">
						<span class="min-w-0 flex-1">
							{detail.degradedMessage}
						</span>
						<button
							class="shrink-0 text-working"
							disabled={loadingBack}
							onclick={() => loadScrollback(scrollbackLines)}
						>
							{loadingBack
								? 'Loading…'
								: scrollback === null
									? 'Load scrollback'
									: 'Reload scrollback'}
						</button>
					</p>
				{/if}

				{#if scrollbackError}
					<p
						role="status"
						class="mb-3 rounded-[10px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger-ink"
					>
						{scrollbackError}
					</p>
				{/if}

				{@render uncertainBanner()}

				{#if canShowEarlier}
					<div use:autoEarlier={wideScreen} class="mb-3 flex justify-center">
						<button
							class="rounded-full border border-edge px-3 py-1.5 text-[11.5px] text-muted disabled:opacity-50"
							disabled={loadingEarlier}
							onclick={showEarlier}
						>
							{#if loadingEarlier}
								Reading further back…
							{:else if hidden > 0}
								Show earlier ({hidden} more)
							{:else}
								Load earlier from disk
							{/if}
						</button>
					</div>
				{/if}

				<div class="flex flex-col gap-3 text-[14.5px] leading-[1.5]">
					{#if scrollback !== null}
						<div
							use:termGrid
							class="term overflow-x-auto rounded-lg border border-hairline bg-card px-3 py-2.5 text-body"
							style="font-size: {prefs.value.monoSize}px"
						>
							{#each scrollback.split('\n') as line, i (i)}
								<!--
									Safe: ansiToHtml escapes every HTML metacharacter in the payload
									and emits only <span style="…"> wrappers for SGR colour — proven
									by the escaping cases in src/lib/ansi.test.ts. Terminal output is
									untrusted, which is exactly why it is escaped rather than trusted.
								-->
								<!-- eslint-disable svelte/no-at-html-tags -->
								<div class="whitespace-pre">{@html ansiToHtml(line, true) || '&nbsp;'}</div>
							{/each}
						</div>
						<div class="flex justify-center gap-2">
							<button
								class="rounded-full border border-edge px-3 py-1.5 text-[11.5px] text-muted"
								disabled={loadingBack}
								onclick={() => loadScrollback(scrollbackLines + 400)}
							>
								Load more ({scrollbackLines} lines shown)
							</button>
							<!-- Scrollback is a still photograph; this is the way back to the live view. -->
							<button
								class="rounded-full border border-edge px-3 py-1.5 text-[11.5px] text-working"
								onclick={() => {
									scrollback = null;
									following = true;
									requestAnimationFrame(scrollBottom);
								}}
							>
								Back to live view
							</button>
						</div>
					{:else}
						{#each rows as row (row.key)}
							{#if row.kind === 'pending'}
								{@const sent = row.sent}
								{@const verdict = queueVerdict(sent.text, detail.queue ?? [])}
								{@const held =
									sent.state !== 'sending' &&
									(verdict !== null
										? verdict === 'taken'
										: onScreen(sent.text, detail.screenTail ?? ''))}
								{#if prefs.value.bubbles}
									<div class="flex justify-end {tight(row.run)}">
										<Bubble
											mine
											run={row.run}
											border={userBorder}
											fill={userFill}
											fillGradient={gradient}
											fillEnd={userEnd}
											tail={prefs.value.bubbleTails}
											width={prefs.value.bubbleBorderWidth}
											ink={userInk}
											extra="max-w-[85%] {sent.state === 'sending' ? 'sending' : 'opacity-60'}"
										>
											{#if sent.question}
												<!--
													The question, above the answer it belongs to. Quiet and
													smaller: the answer is what you said, the question is
													only there so it still makes sense once the card that
													asked it has gone.
												-->
												<span
													class="mb-1 block border-l-2 border-current/25 pl-2 text-[12.5px] opacity-70"
													>{sent.question}</span
												>
											{/if}<span class="whitespace-pre-wrap">{sent.text.trimEnd()}</span>
											{#snippet meta()}
												<BubbleMeta
													at={sent.at}
													run={row.run}
													state={sent.state === 'sending' ? 'sending' : held ? 'read' : 'sent'}
												/>
											{/snippet}
										</Bubble>
									</div>
								{:else}
									<div class="flex gap-2 opacity-60">
										<span
											class="shrink-0 font-mono text-[13px] leading-[1.7] text-working"
											aria-hidden="true">›</span
										>
										<span
											class="min-w-0 flex-1 font-medium [overflow-wrap:anywhere] whitespace-pre-wrap"
										>
											{#if sent.question}<span class="block text-[12.5px] font-normal text-muted"
													>{sent.question}</span
												>{/if}{sent.text.trimEnd()}
										</span>
									</div>
								{/if}
							{:else if row.kind === 'tools'}
								<!--
									A folded run of tool-only turns. One row, opened on demand —
									the transcript keeps the shape of the conversation and the
									work is still one tap away.

									Guarded by showWork like every other tool row. Folding is about
									how the work is PRESENTED; the toggle is about whether it is
									shown at all, and a group that ignored it put tool rows back on
									screen for anyone who had turned them off.
								-->
								<!--
									The kind check stays pure so the {:else} below still narrows to
									a message row; the toggle is checked inside it.
								-->
								{#if showWork}
									<details class="group">
										<summary
											class="flex cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1.5 font-mono text-[11.5px] text-muted transition-colors hover:bg-chip/60"
										>
											<span
												class="shrink-0 self-center text-faint transition-transform group-open:rotate-90 motion-reduce:transition-none"
												aria-hidden="true">▸</span
											>
											<span class="min-w-0 flex-1 truncate">
												{#each row.tally as t, i (t.name)}{#if i > 0}<span class="mx-1 text-faint"
															>·</span
														>{/if}<span class="text-faint">{t.n}</span>&nbsp;{t.name}{/each}
											</span>
										</summary>
										<div class="pl-2">
											<MessageBlocks blocks={row.blocks} mono={prefs.value.monoSize} showWork />
										</div>
									</details>
								{/if}
							{:else}
								{@const message = row.message}
								{#if message.role === 'system'}
									<div class="flex justify-center">
										<span
											class="rounded-full border border-hairline bg-card px-3 py-1 font-mono text-[11px] text-muted"
											>{message.text}</span
										>
									</div>
								{:else if message.role === 'user'}
									{#if prefs.value.bubbles}
										<div class="flex justify-end {tight(row.run)}">
											<Bubble
												mine
												run={row.run}
												border={userBorder}
												fill={userFill}
												fillGradient={gradient}
												fillEnd={userEnd}
												tail={prefs.value.bubbleTails}
												width={prefs.value.bubbleBorderWidth}
												ink={userInk}
												extra="max-w-[85%]"
											>
												<MessageBlocks
													blocks={message.blocks ?? []}
													mono={prefs.value.monoSize}
													plain
												/>
												{#snippet meta()}
													<BubbleMeta at={message.at ?? 0} run={row.run} state="read" />
												{/snippet}
											</Bubble>
										</div>
									{:else}
										<div class="flex gap-2 {tight(row.run)}">
											<span
												class="shrink-0 font-mono text-[13px] leading-[1.7] text-working"
												aria-hidden="true">›</span
											>
											<span class="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
												<MessageBlocks
													blocks={message.blocks ?? []}
													mono={prefs.value.monoSize}
													plain
												/>
											</span>
											{#if prefs.value.messageTicks}
												<span class="mt-[3px] shrink-0 text-faint"><Ticks state="read" /></span>
											{/if}
										</div>
									{/if}
								{:else if message.text || prose(message).length > 0 || hasTodoPlan(message.blocks) || (showWork && (message.blocks?.length ?? 0) > 0)}
									<!--
										A turn that is only tool calls has nothing to show while the
										work is hidden; rendering the prefix anyway left a column of
										bare dots separated by empty space.

										`prose` and not just `message.text`: a turn can carry an image
										and no words — a file sent to the phone is exactly that — and
										`text` is empty for it, so the whole row was being skipped and
										the picture went with it whenever the work was hidden. An
										image is something the agent SAID, not work it did.
									-->
									<div class="flex gap-2 {tight(row.run)}">
										{#if !prefs.value.bubbles}
											<span
												class="shrink-0 font-mono text-[13px] leading-[1.7] {harnessText(
													detail.agent
												)}"
												aria-hidden="true">·</span
											>
										{/if}
										<div class="min-w-0 flex-1">
											{#if prefs.value.bubbles}
												{@const segments = messageSegments(message.blocks)}
												{#each segments as segment, segmentIndex (segmentIndex)}
													{#if segment.kind === 'prose'}
														<Bubble
															run={bubbleRun(row.run, segments, segmentIndex)}
															border={agentBorder}
															fill={agentFill}
															fillGradient={gradient}
															fillEnd={agentEnd}
															tail={prefs.value.bubbleTails}
															width={prefs.value.bubbleBorderWidth}
															ink={agentInk}
															extra="max-w-[92%] block"
														>
															<MessageBlocks blocks={segment.blocks} mono={prefs.value.monoSize} />
															{#snippet meta()}
																<!--
																	No ticks on an agent's own turn: a tick says whether something
																	YOU sent arrived, and this did not come from you. Time only.
																-->
																<BubbleMeta
																	at={message.at ?? 0}
																	run={bubbleRun(row.run, segments, segmentIndex)}
																/>
															{/snippet}
														</Bubble>
													{:else}
														<MessageBlocks
															blocks={segment.blocks}
															mono={prefs.value.monoSize}
															{showWork}
														/>
													{/if}
												{/each}
											{:else}
												<div
													class="border-l-2 pl-2.5 [overflow-wrap:anywhere] text-body {harnessBorder(
														detail.agent
													)}"
												>
													<MessageBlocks
														blocks={message.blocks ?? []}
														mono={prefs.value.monoSize}
														{showWork}
													/>
												</div>
											{/if}
										</div>
									</div>
								{/if}
							{/if}
						{/each}

						<!--
								What the harness says it is doing, in its own words. "working"
								was all bordr could say; the pane has always known the verb,
								the elapsed time and the tokens spent.
							-->
						{#if detail.status === 'working'}
							<div class="ml-[22px]">
								<div class="flex items-center gap-1.5 font-mono text-[11px] text-muted">
									{#each [0, 1, 2] as n (n)}
										<span
											class="h-1 w-1 rounded-full bg-working motion-safe:animate-[bordr-pulse_1.2s_ease-in-out_infinite]"
											style="animation-delay: {n * 0.2}s; opacity: {1 - n * 0.35}"
										></span>
									{/each}
									<span class="min-w-0 truncate"
										>{(prefs.value.showActivity ? detail.activity?.text : null) ?? 'working'}</span
									>
								</div>
								{#if prefs.value.showActivity && detail.activity?.tip}
									<p class="mt-0.5 text-[11px] text-faint">{detail.activity.tip}</p>
								{/if}
							</div>
						{/if}

						<!--
							Sent, accepted by herdr, not yet in the transcript.

							BELOW the working indicator, which is where the terminal puts
							it: the agent is still finishing the turn above, and your
							prompt is waiting behind it. Above the spinner it read as
							though it had already been picked up.
						-->
					{/if}

					{#if toolCount > 0 && prefs.value.workControl === 'inline'}
						<div class="flex justify-center">
							<button
								class="rounded-full px-3 py-1 text-[11.5px] text-working"
								onclick={() => {
									showWork = !showWork;
									prefs.set('showWork', showWork);
								}}
							>
								{showWork ? 'Hide' : 'Show'} the work ({toolCount})
							</button>
						</div>
					{/if}
				</div>

				{@render pickerCard()}

				{#if !detail.picker && detail.menu}
					<!-- A menu bordr could not read as options (omp's model browser,
					     Claude Code's /config): say so, and open the key strip. -->
					<section
						class="mt-4 flex overflow-hidden rounded-xl border border-blocked-edge bg-blocked-surface"
					>
						<span class="w-1 shrink-0 self-stretch bg-blocked"></span>
						<div class="min-w-0 flex-1 p-3">
							<p class="font-mono text-[10.5px] tracking-[.3px] text-blocked-ink">
								⌨ MENU OPEN ON THE TERMINAL
							</p>
							<p class="mt-1.5 text-[13px] [overflow-wrap:anywhere] text-muted">{detail.menu}</p>
							{#if !showControls}
								<button
									class="mt-2.5 rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-card"
									onclick={() => {
										showControls = true;
										requestAnimationFrame(() => screenBox?.scrollIntoView({ block: 'start' }));
									}}
								>
									Show the screen and key strip
								</button>
							{/if}
						</div>
					</section>
				{/if}

				{#if showControls}
					<div class="mt-4">
						<!--
							The whole pane, scrollable, held at the bottom where the prompt
							and footer live; a long panel (Claude Code's /config) is read by
							scrolling up inside the box rather than being cut off.
						-->
						<div
							use:termGrid
							bind:this={screenBox}
							onscroll={onScreenScroll}
							class="term max-h-[60vh] overflow-auto rounded-[10px] border border-hairline bg-card px-3 py-2.5 text-body"
							style="font-size: {prefs.value.monoSize}px"
						>
							{#each detail.screenTail.split('\n') as line, i (i)}
								<!--
									Safe: ansiToHtml escapes every HTML metacharacter in the payload
									and emits only <span style="…"> wrappers for SGR colour — proven
									by the escaping cases in src/lib/ansi.test.ts. Terminal output is
									untrusted, which is exactly why it is escaped rather than trusted.
								-->
								<!-- eslint-disable svelte/no-at-html-tags -->
								<div class="whitespace-pre">{@html ansiToHtml(line, true) || '&nbsp;'}</div>
							{/each}
						</div>
						<p class="mt-1 text-[11.5px] text-faint">
							The pane's screen, live · scroll up inside it for the rest
						</p>
					</div>
				{/if}
			</main>

			<div
				class="sticky bottom-0 z-10 w-full max-w-screen-sm lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl"
			>
				<!--
						Above the whole composer stack, never on it: the suggestion chip
						and the input are the two things you are reaching for, and a pill
						parked over either is worse than no pill. Absolute inside the
						sticky wrapper, so it overlays the transcript only.
					-->
				{#if !following}
					<div class="pointer-events-none absolute -top-9 right-0 left-0 flex justify-center">
						<button
							class="pointer-events-auto flex items-center gap-1 rounded-full border border-hairline bg-card px-3 py-1.5 text-[12.5px] text-working shadow-[0_2px_8px_rgba(0,0,0,.18)]"
							onclick={() => {
								following = true;
								scrollBottom();
							}}
						>
							<span aria-hidden="true">↓</span> Latest
						</button>
					</div>
				{/if}
				<div
					class="border-t border-hairline bg-page px-3 py-2.5"
					style="padding-bottom: max(0.625rem, env(safe-area-inset-bottom))"
				>
					<!--
					The harness's own ghost prompt. Tapping fills the box rather than
					sending: on a phone you cannot see what you are about to commit to
					the way you can in a terminal, and it is usually a starting point
					worth editing. Hidden the moment you type anything of your own.
				-->
					{#if prefs.value.showSuggestions && detail.suggestion && draft.trim() === ''}
						<button
							class="mb-2 flex w-full items-center gap-2 rounded-xl border border-hairline bg-card px-3 py-2 text-left"
							onclick={() => {
								draft = detail.suggestion ?? '';
								textarea?.focus();
							}}
						>
							<span class="shrink-0 text-[13px] text-faint" aria-hidden="true">&rarr;</span>
							<span class="min-w-0 flex-1 truncate text-[14px] text-muted">{detail.suggestion}</span
							>
						</button>
					{/if}

					{#if previews.length > 0 || preparing > 0}
						<div class="mb-2 flex items-center gap-2 overflow-x-auto">
							{#each previews as src, i (src)}
								<span class="relative shrink-0">
									<img
										{src}
										alt=""
										class="h-16 w-16 rounded-[10px] border border-hairline object-cover"
									/>
									<button
										class="absolute -top-1.5 -right-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-ink text-[11px] text-card"
										aria-label="Remove image"
										onclick={() => removeAt(i)}>✕</button
									>
								</span>
							{/each}
							{#if preparing > 0}
								<span
									class="flex h-16 w-16 shrink-0 items-center justify-center rounded-[10px] border border-dashed border-hairline font-mono text-[11px] text-faint"
									role="status"
									aria-live="polite"
								>
									{preparing > 1 ? `${preparing} more…` : 'shrinking…'}
								</span>
							{/if}
							<span class="shrink-0 font-mono text-[11px] text-faint">{attachments.length} / 6</span
							>
						</div>
					{/if}

					{#if slashQuery}
						<div
							class="mb-2 max-h-[45vh] overflow-y-auto rounded-xl border border-edge bg-card"
							role="listbox"
							aria-label="Slash commands"
						>
							{#if commandList === null}
								<p class="px-3 py-2 text-[12.5px] text-muted">Loading commands…</p>
							{:else if suggestions.length === 0}
								<p class="px-3 py-2 text-[12.5px] text-muted">Nothing matches {draft}.</p>
							{:else}
								{#each suggestions as command (command.name)}
									<button
										type="button"
										role="option"
										aria-selected="false"
										class="flex w-full items-baseline gap-2 border-b border-hairline px-3 py-2 text-left last:border-b-0"
										onclick={() => pickCommand(command)}
									>
										<span class="shrink-0 font-mono text-[13px] text-working">/{command.name}</span>
										<span class="min-w-0 flex-1 truncate text-[12.5px] text-muted"
											>{command.description}</span
										>
										{#if command.source !== 'builtin'}
											<span class="shrink-0 font-mono text-[10px] text-faint">{command.source}</span
											>
										{/if}
									</button>
								{/each}
							{/if}
						</div>
					{/if}

					{@render errorBanner()}

					{#if typedInto && detail.picker}
						<!--
							Typed, not sent — and the difference matters, because Enter
							inside a picker takes the highlighted option rather than what
							was just typed. The key strip is where ⏎ lives.
						-->
						<p role="status" class="mb-2 rounded-[10px] bg-chip px-3 py-2 text-[12.5px] text-muted">
							Typed into the question. Press <span class="font-mono">⏎</span> on the key strip when it
							looks right — the question's own footer says what else it takes.
						</p>
					{/if}

					<!--
					A `!` draft is a SHELL command, not a message to the agent — it runs
					on the host. The box says so before you send it, because the two are
					one keystroke apart and only one of them is undoable.
				-->
					<div
						class="flex items-end gap-1.5 rounded-xl border p-2 {isShell
							? 'border-working bg-working-bg'
							: 'border-edge bg-card'}"
					>
						<button
							class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg {showControls
								? 'bg-working-bg text-working'
								: 'text-muted'}"
							aria-label="Manual controls"
							aria-pressed={showControls}
							onclick={() => {
								showControls = !showControls;
								// Remembered, not just for this conversation: the keyboard
								// button is the only place most people will ever change
								// this, and it used to reset on every open.
								prefs.set('keyStrip', showControls ? 'always' : 'peek');
							}}
						>
							<Icon name="keyboard" size={19} />
						</button>
						<button
							class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg text-muted"
							aria-label="Attach a photo"
							onclick={() => fileInput?.click()}
						>
							<Icon name="camera" size={19} />
						</button>
						<input
							bind:this={fileInput}
							type="file"
							accept="image/*"
							multiple
							class="hidden"
							onchange={(e) => void addFiles(e.currentTarget)}
						/>
						<!--
							pr-2, not scrollbar-gutter: once the draft is long enough to
							scroll, a phone draws its scrollbar as an OVERLAY, on top of
							the text rather than beside it, and clipped the last character
							of every wrapped line. A reserved gutter does nothing about an
							overlay; padding is what moves the text out from under it.
						-->
						<!--
							`aria-label` as well as the placeholder. The placeholder says what
							this box does RIGHT NOW — run a command on the host, answer the
							question on screen — which is useful and is exactly why it cannot
							be the name: it moves with the pane's state, and a placeholder
							disappears the moment you type into it.
						-->
						<textarea
							bind:this={textarea}
							bind:value={draft}
							onkeydown={onKeydown}
							onpaste={onPaste}
							rows="1"
							aria-label="Message"
							placeholder={isShell
								? 'Runs on the host…'
								: detail.picker
									? 'Type into the question…'
									: 'Type a reply…'}
							class="[field-sizing:content] max-h-[min(10rem,22dvh)] min-w-0 flex-1 resize-none bg-transparent py-1.5 pr-2 text-[16px] placeholder:text-faint focus:outline-none"
						></textarea>
						{#if speechSupported}
							{#if dictating}
								<button
									class="flex h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-danger-bg px-2.5"
									aria-label="Stop dictation"
									onclick={toggleDictation}
								>
									<span class="h-2.5 w-2.5 rounded-[2px] bg-danger" aria-hidden="true"></span>
									<span class="flex items-end gap-px" aria-hidden="true">
										{#each [3, 6, 4, 8, 5, 9, 4, 7, 3, 6] as h, n (n)}
											<span
												class="w-px bg-danger motion-safe:animate-[bordr-pulse_1s_ease-in-out_infinite]"
												style="height: {h}px; animation-delay: {n * 0.08}s"
											></span>
										{/each}
									</span>
									<span class="font-mono text-[11px] text-danger-ink">stop</span>
								</button>
							{:else}
								<button
									class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg text-muted"
									aria-label="Dictate"
									onclick={toggleDictation}
								>
									<Icon name="mic" size={19} />
								</button>
							{/if}
						{/if}
						<button
							class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg text-white {draft.trim() ||
							attachments.length > 0
								? 'bg-working'
								: 'bg-idle-rail'}"
							aria-label="Send"
							disabled={busy || preparing > 0}
							onclick={send}
						>
							{#if busy || preparing > 0}
								<Spinner size={17} label="Sending" />
							{:else}
								<Icon name="arrow-up" size={19} />
							{/if}
						</button>
					</div>

					{#if dictating}
						<p class="mt-1.5 text-center text-[11px] text-faint" role="status">
							{#if interim}
								<span class="italic">{interim}</span>
							{:else}
								Web Speech · {prefs.value.dictationLang} ·
								{prefs.value.dictationHold ? 'until you tap stop' : 'stops at a pause'}
								{screenHeld ? '· screen stays on' : ''} ·
								{prefs.value.enterSends ? '⏎ sends' : '⌘⏎ sends, ⏎ is a newline'}
							{/if}
						</p>
					{/if}

					{#if showControls}
						<div class="mt-2 grid grid-cols-9 gap-[5px]">
							{#each KEY_STRIP as key (key.k)}
								<button
									class="min-h-11 rounded-md py-2.5 font-mono text-[12px] {flashKey === key.k
										? 'bg-working text-white'
										: 'bg-key text-key-ink'}"
									aria-label={key.k}
									onclick={() => tapKey(key.k)}
								>
									{key.l}
								</button>
							{/each}
						</div>
					{/if}
				</div>
				<!--
						The other home for the status block: under the composer, where the
						on-screen keyboard covers it rather than the conversation.
					-->
				<!--
					Parked under the composer, this block is the last thing on the
					screen, so the home bar and the navigation bar are ITS problem:
					the composer's own safe-area padding now sits above it and
					protects nothing. Without this the rows are drawn into the
					gesture area.
				-->
				{#if detail.statusLines.length > 0 && prefs.value.statusPosition === 'bottom'}
					<div
						class="border-t border-hairline bg-page pt-1.5"
						style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom))"
					>
						<StatusBlock
							rows={statusRows}
							agent={detail.agent}
							open={statusOpen}
							ontoggle={() => (statusOpen = !statusOpen)}
						/>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}
{#snippet pickerCard()}
	{#if detail.picker && detail.picker.options.length > 0 && !askHidden}
		<section
			class="mt-4 flex overflow-hidden rounded-xl border border-blocked-edge bg-blocked-surface shadow-[0_6px_18px_rgba(217,119,6,.10)]"
		>
			<span class="w-1 shrink-0 self-stretch bg-blocked"></span>
			<div class="min-w-0 flex-1 p-3">
				<p class="font-mono text-[10.5px] tracking-[.3px] text-blocked-ink">
					? WAITING ON YOU{detail.picker.multi ? ' · MULTI-SELECT' : ''}
				</p>
				<!--
					What is being approved, above the question that asks about it.
					"Do you want to proceed?" with two buttons and no subject is an
					approval prompt with the one thing you need to decide on
					missing — it was on screen the whole time, one line further up.
				-->
				{#if detail.picker.context.length > 0}
					<div
						class="mt-1.5 max-h-40 overflow-y-auto rounded-lg bg-code-bg px-2.5 py-2 font-mono text-[11.5px] break-words whitespace-pre-wrap text-code-ink"
					>
						{detail.picker.context.join('\n')}
					</div>
				{/if}
				{#if detail.picker.question}
					<p class="mt-1.5 text-[15px]">{detail.picker.question}</p>
				{/if}
				<div class="mt-2 flex flex-col gap-1.5">
					{#each detail.picker.options as option (option.index)}
						{@const sending = sendingIndex === option.index}
						<button
							class="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[14px] transition-opacity {busy &&
							!sending
								? 'opacity-40'
								: ''} {sending ? 'animate-pulse' : ''} {detail.picker.multi
								? option.selected
									? 'border border-working bg-card'
									: 'border border-black/[.08] bg-card dark:border-white/[.08]'
								: option.selected
									? 'bg-ink text-card'
									: 'border border-black/[.08] bg-card dark:border-white/[.08]'}"
							disabled={busy}
							onclick={() => answer(option.index)}
						>
							{#if detail.picker.multi}
								<span
									class="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[12px] {option.checked
										? 'bg-working text-white'
										: 'border-[1.5px] border-idle-rail'}">{option.checked ? '✓' : ''}</span
								>
							{:else if sending}
								<!-- In place of the number, not beside it: the row must not
								     reflow under the finger that just left it. -->
								<Spinner size={14} label="Sending your answer" />
							{:else}
								<span class="shrink-0 font-mono text-[12px]"
									>{option.selected ? '❯ ' : ''}{option.index}</span
								>
							{/if}
							<span class="min-w-0 flex-1">{option.label}</span>
						</button>
					{/each}
				</div>
				{#if detail.picker.multi}
					<button
						class="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-3 text-[14px] font-medium text-card disabled:opacity-50"
						disabled={busy}
						onclick={() => sendKeys(['enter'])}
					>
						{#if busy}<Spinner size={14} label="Sending your selection" />{/if}
						Submit selection
					</button>
				{/if}
				<p class="mt-2 text-[11px] text-faint">
					{#if detail.picker.axis === 'horizontal'}
						Arrow keys move the slider and Enter confirms; verified against the screen.
					{:else if detail.picker.numbered}
						Digit is sent as a keystroke and verified against the screen.
					{:else}
						Arrow keys and Enter are sent, then verified against the screen.
					{/if}
				</p>
			</div>
		</section>
	{/if}
{/snippet}
{#snippet splitTile(paneId: string)}
	{#if paneId === detail.paneId}
		<div
			class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ring-1 ring-working/50 ring-inset"
		>
			{@render conversation()}
		</div>
	{:else}
		<PaneScreen
			{paneId}
			onopen={() =>
				goto(resolve('/a/[pane]', { pane: paneId }), {
					replaceState: prefs.value.backTo === 'home'
				})}
		/>
	{/if}
{/snippet}

{#snippet paneHeader()}
	<AppHeader
		onmenu={() =>
			wideScreen ? prefs.set('sidebarOpen', !prefs.value.sidebarOpen) : (treeOpen = !treeOpen)}
		menuLabel={wideScreen
			? prefs.value.sidebarOpen
				? 'Hide the session list'
				: 'Show the session list'
			: 'Session list'}
		menuExpanded={wideScreen ? prefs.value.sidebarOpen : treeOpen}
		middle={headerTitle}
		actions={headerActions}
		below={detail.cwd || detail.branch || modelLine.model ? headerLocation : undefined}
	/>
{/snippet}

<!--
	Desktop adds a session tree beside the conversation; the phone gets
	exactly what it had. Everything is one breakpoint — there is no second
	conversation component to keep in step, which is what makes this safe.
-->
<!--
	Every link out of an agent replaces rather than pushes, unless you have
	asked for the old behaviour. Swiping already did this; tapping a pane in
	the drawer, a tab in the strip, or a tile in the split did not, so a few
	minutes of switching left the back gesture ten steps from the agents list.
	Back is the way home on a phone. Sideways is what the strip and the swipe
	are for.
-->
<div
	class="lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden"
	data-sveltekit-replacestate={prefs.value.backTo === 'home' ? '' : 'false'}
>
	{#if wideScreen}
		<header class="shrink-0 border-b border-hairline bg-page">
			{@render paneHeader()}
		</header>
	{/if}
	<div class="lg:flex lg:min-h-0 lg:w-full lg:min-w-0 lg:flex-1">
		<!--
		Mounted only at desktop widths, not merely hidden: a `hidden lg:block`
		aside still exists on a phone, which meant two trees polling /api/panes
		and a stray copy of the drawer's markup in the DOM.
	-->
		{#if wideScreen && prefs.value.sidebarOpen}
			<aside class="relative hidden shrink-0 lg:block" style="width: {prefs.value.sidebarWidth}px">
				<SessionTree current={detail.paneId} onnew={() => (showNewAgent = true)} />
				<SidebarResizer onreset={() => prefs.set('sidebarWidth', DEFAULT_SIDEBAR)} />
			</aside>
		{/if}

		<!--
		The same tree as a drawer below lg. One component, so the phone and the
		desktop can never drift; only how it is presented changes.
	-->
		{#if treeOpen}
			<div class="fixed inset-0 z-40 lg:hidden">
				<!--
					The scrim closes the drawer on a tap, but it is not the control:
					the drawer's own header has a labelled Close button now, so
					announcing this as a second "Close the session list" would put two
					identically named buttons in the tree for one job. Presentational,
					and not focusable, so the real button is the one you reach.
				-->
				<button
					class="no-press absolute inset-0 bg-black/40"
					aria-hidden="true"
					tabindex="-1"
					onclick={() => (treeOpen = false)}
				></button>
				<div class="absolute inset-y-0 left-0 w-[86%] max-w-[320px] shadow-2xl">
					<SessionTree
						current={detail.paneId}
						onclose={() => (treeOpen = false)}
						home
						onnew={() => {
							treeOpen = false;
							showNewAgent = true;
						}}
					/>
				</div>
			</div>
		{/if}
		{#if wideScreen && splitLayout}
			<!--
			The tab as herdr has it: the pane you are in holds the transcript and
			the composer, and every other pane in the split shows its own screen.
			A tile IS the pane, not a picture of it — which is the whole point of
			showing the split rather than a row of chips.
		-->
			<!--
				min-w-0 matters here: without it this flex item sizes to its
				content, and a pane whose screen holds one long unwrapped line
				pushed the whole split wider than the window rather than scrolling
				inside its own tile.
			-->
			<div class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
				<PaneSplit node={splitLayout.tree} tile={splitTile} onratio={setRatio} />
			</div>
		{:else}
			{@render conversation()}
		{/if}
	</div>
	<NewAgentSheet open={showNewAgent} onclose={() => (showNewAgent = false)} />
	{#if controlling}
		<ControlSheet
			targets={controlTargets}
			subagents={strip === 'off' ? [] : finished}
			onsubagent={(id) => {
				controlling = false;
				openSub = id;
			}}
			onclose={() => (controlling = false)}
			ondone={afterControl}
			onworktrees={detail.cwd
				? () => {
						controlling = false;
						worktrees = true;
					}
				: undefined}
		/>
	{/if}
	{#if worktrees && detail.cwd}
		<WorktreeSheet
			pane={detail.paneId}
			cwd={detail.cwd}
			onclose={() => (worktrees = false)}
			ondone={() => void invalidateAll()}
		/>
	{/if}
	{#if openSubAgent}
		<SubagentSheet pane={detail.paneId} agent={openSubAgent} onclose={() => (openSub = null)} />
	{/if}
</div>

<style>
	/*
	 * The tail on the last bubble of a run.
	 *
	 * A rotated square with two of its four sides drawn, so it reads as the
	 * bubble's own outline carrying on past the corner rather than as a
	 * separate shape stuck to the side. Its fill is the bubble's fill and its
	 * strokes are --tail-ink, both handed down from the inline style, so it
	 * follows the harness colour and the outline/fill setting without this
	 * rule needing to know about either.
	 */
	:global(.tail) {
		position: relative;
	}

	/*
	 * In flight. A slow breath rather than a spinner: the message is already
	 * readable and the only thing unresolved is whether it has landed, so the
	 * bubble should look provisional, not busy.
	 */
	:global(.sending) {
		animation: bordr-sending 1.1s ease-in-out infinite;
	}

	@keyframes bordr-sending {
		0%,
		100% {
			opacity: 0.45;
		}
		50% {
			opacity: 0.8;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.sending) {
			animation: none;
			opacity: 0.6;
		}
	}

	/*
	 * Terminal snapshots, not UI text. The system monospace goes first: IBM
	 * Plex Mono has no box-drawing glyphs, so a mixed line falls back per glyph
	 * and loses its grid. `.tc` then pins whatever font does serve a non-ASCII
	 * glyph to exactly one cell, which is what keeps a ruler and its marker in
	 * the same column.
	 */
	.term {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace;
		font-variant-ligatures: none;
	}
	.term :global(.tc) {
		display: inline-block;
		/* --cell is measured from this element's real font; 1ch is only a last
		   resort for the moment before the action runs. */
		width: var(--cell, 1ch);
		text-align: center;
		overflow: hidden;
	}
	.term :global(.tc-w) {
		width: calc(var(--cell, 1ch) * 2);
	}
</style>
