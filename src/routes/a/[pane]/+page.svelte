<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { agentStore } from '$lib/agents.svelte';
	import { mergeResults } from '$lib/dictation';
	import { shrinkImage } from '$lib/shrink-image';
	import { prefs } from '$lib/prefs.svelte';
	import { flatOrder } from '$lib/grouping';
	import { decideSwipe, inHorizontalScroller, neighbourPane } from '$lib/swipe';
	import { harnessBorder, harnessBubble, harnessHex, harnessText, STATUS_INK } from '$lib/theme';
	import { ansiToHtml } from '$lib/ansi';
	import { termGrid } from '$lib/term-grid';
	import { throttleTrailing } from '$lib/throttle';
	import { rankCommands, type SlashCommand } from '$lib/commands';
	import HarnessMark from '$lib/components/harness-mark.svelte';
	import AppHeader from '$lib/components/app-header.svelte';
	import PaneTerminal from '$lib/components/pane-terminal.svelte';
	import PaneScreen from '$lib/components/pane-screen.svelte';
	import PaneSplit from '$lib/components/pane-split.svelte';
	import Icon from '$lib/components/icon.svelte';
	import MessageBlocks from '$lib/components/message-blocks.svelte';
	import SessionTree from '$lib/components/session-tree.svelte';
	import WorkspaceTabs from '$lib/components/workspace-tabs.svelte';
	import StatusBlock from '$lib/components/status-block.svelte';
	import NewAgentSheet from '$lib/components/new-agent-sheet.svelte';
	import type { Block } from '$lib/server/transcript/types';
	import type { WorkspaceNode } from '$lib/types';
	let { data } = $props();

	const TAIL = 80;

	/**
	 * Tool calls, results and thinking. Starts from the persisted preference
	 * so the choice survives leaving the conversation — it used to reset to
	 * hidden on every open, which made the work look like it was not there.
	 */
	let showWork = $state(prefs.value.showWork);
	/** The ＋ in the desktop tree opens the same sheet the agents list uses. */
	let showNewAgent = $state(false);
	/** The session tree as a drawer, on a phone. */
	let treeOpen = $state(false);
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

	const splitLayout = $derived.by(() => {
		if (!prefs.value.splitPanes) return undefined;
		for (const workspace of workspaces) {
			for (const tab of workspace.tabs) {
				if (!tab.panes.some((p) => p.paneId === detail.paneId)) continue;
				return tab.panes.length > 1 ? tab.layout : undefined;
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

	/**
	 * A bubble holds what was SAID; tool calls and thinking sit outside it.
	 *
	 * codex and pi routinely emit a turn with no prose at all — just a tool
	 * call — and wrapping that in a coloured bubble drew an empty bubble with
	 * a row inside it. The prefixed transcript has no such problem, so this
	 * split only applies to bubbles.
	 */
	function prose(message: { blocks?: Block[] }): Block[] {
		return (message.blocks ?? []).filter((b) => b.kind === 'text' || b.kind === 'image');
	}

	function work(message: { blocks?: Block[] }): Block[] {
		return (message.blocks ?? []).filter((b) => b.kind === 'tool' || b.kind === 'thinking');
	}

	/**
	 * The manual harness controls: the screen peek and the key strip together.
	 * They belong together — you press a key and watch the screen react — and
	 * the ⌨ button is what shows and hides them. `keyStrip` in Settings only
	 * decides whether they start open.
	 */
	let showControls = $state(prefs.value.keyStrip === 'always');
	let draft = $state('');

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
	let statusOpen = $state(false);
	let uncertain = $state<string | null>(null);
	let sendError = $state<string | null>(null);
	let scrollback = $state<string | null>(null);
	let scrollbackLines = $state(400);
	let loadingBack = $state(false);
	let scrollbackError = $state<string | null>(null);
	let flashKey = $state('');

	const detail = $derived(data.detail);

	/**
	 * The status footer with its terminal colour. `statusAnsi` carries the
	 * same lines as `statusLines` with their escapes intact; the fallback
	 * covers a payload cached on a phone that has not reloaded yet.
	 */
	const statusRows = $derived(detail.statusAnsi?.length ? detail.statusAnsi : detail.statusLines);

	/**
	 * How the harness shows on an agent bubble.
	 *
	 * 'edge' is the default because blending an accent into the background
	 * muddies it — orange into a light grey is a dull beige, and every theme
	 * colour it touches shifts. A stripe down the side carries the accent at
	 * full strength and leaves the bubble the colour it was.
	 */
	const accentMode = $derived(prefs.value.agentBubble ? 'off' : prefs.value.harnessAccent);
	const agentBubbleColour = $derived(
		accentMode === 'tint'
			? harnessBubble(detail.agent, prefs.resolvedTheme === 'dark', prefs.bubbleColours.agentBubble)
			: prefs.bubbleColours.agentBubble
	);
	const agentEdge = $derived(
		accentMode === 'edge' ? harnessHex(detail.agent, prefs.resolvedTheme === 'dark') : ''
	);
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
	type Row =
		| { kind: 'message'; message: (typeof visibleMessages)[number]; key: string }
		| { kind: 'pending'; sent: { id: number; text: string; at: number }; key: string };

	const rows = $derived.by((): Row[] => {
		const base = detail.messages.length - visibleMessages.length;
		const out: Row[] = visibleMessages.map((message, i) => ({
			kind: 'message' as const,
			message,
			key: `m${base + i}`
		}));
		for (const sent of [...pendingSends].sort((a, b) => a.at - b.at)) {
			out.push({ kind: 'pending', sent, key: `p${sent.id}` });
		}
		return out;
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
	let pendingSends = $state<{ id: number; text: string; at: number }[]>([]);
	let pendingSeq = 0;

	/**
	 * Queued prompts survive leaving the conversation.
	 *
	 * They used to be component state, so switching agent or reloading lost
	 * them — and a queued prompt is exactly the thing you leave the app and
	 * come back to check on. Stored per pane, because they belong to that
	 * agent's queue and nothing else.
	 */
	const PENDING_KEY = $derived(`bordr-pending:${detail.paneId}`);
	/** A prompt still unclaimed after this long is not coming back. */
	const PENDING_TTL_MS = 6 * 60 * 60 * 1000;

	$effect(() => {
		// Re-runs when the pane changes, which is what makes switching agents
		// load that agent's queue rather than keeping the last one's.
		const key = PENDING_KEY;
		let restored: typeof pendingSends = [];
		try {
			const raw = JSON.parse(localStorage.getItem(key) ?? '[]');
			const now = Date.now();
			if (Array.isArray(raw)) {
				restored = raw.filter(
					(p) => p && typeof p.text === 'string' && now - Number(p.at ?? 0) < PENDING_TTL_MS
				);
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
		// An array rather than a Set: this is a local scratch value, and the
		// lint rule that steers reactive state to SvelteSet cannot tell the
		// difference. There are only ever a handful of unsent prompts.
		const landed: string[] = [];
		for (const message of detail.messages) {
			if (message.role !== 'user') continue;
			if (message.text.trim()) landed.push(message.text.trim());
			for (const block of message.blocks ?? []) {
				if (block.kind !== 'tool' || block.name !== '!') continue;
				const command = String(block.input?.command ?? '').trim();
				if (command) landed.push(`!${command}`);
			}
		}

		// A prompt cannot still be queued once the agent has stopped: if it had
		// been taken it would be in the transcript, and if it has not it is
		// never going to be. The grace period covers the transcript lagging the
		// state change by a beat.
		const settled = detail.status === 'idle' || detail.status === 'done';
		const now = Date.now();
		const still = pendingSends.filter(
			(p) => !landed.includes(p.text.trim()) && !(settled && now - p.at > 20_000)
		);
		if (still.length !== pendingSends.length) pendingSends = still;
	});

	/**
	 * The list store, not a second raw EventSource: it already owns the
	 * reconnect logic, and its agent list is what swipe navigates through — so
	 * "next agent" always means the next one the list would show.
	 */
	const store = agentStore;
	const order = $derived(flatOrder(store.agents, prefs.value.groupBy, prefs.value.sort));
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
	 * Whatever is actually scrolling.
	 *
	 * On the phone that is the window. On desktop the conversation column
	 * scrolls inside itself so the session tree can stay put — which silently
	 * broke stick-to-bottom, because `window.scrollY` never moves there.
	 */
	function scrollHost(): HTMLElement | null {
		if (!swipeRoot) return null;
		return getComputedStyle(swipeRoot).overflowY === 'auto' ? swipeRoot : null;
	}

	function scrollBottom() {
		const host = scrollHost();
		if (host) host.scrollTop = host.scrollHeight;
		else window.scrollTo({ top: document.body.scrollHeight });
	}

	/** Within a screenful-ish of the end, which is what "following" means. */
	function nearBottom(): boolean {
		const host = scrollHost();
		if (host) return host.scrollTop + host.clientHeight >= host.scrollHeight - 160;
		return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
	}

	/**
	 * Whether the reader is following the end. Drives the jump button: showing
	 * it while already at the bottom is noise, and hiding it while scrolled up
	 * is the thing that makes a long transcript feel like a trap.
	 */
	let following = $state(true);

	function onScroll() {
		following = nearBottom();
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
		const observer = new ResizeObserver(onScroll);
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
		// Never yank the page out from under a copy: re-rendering destroys
		// an active selection, and lifting an error out of a transcript is
		// a core phone use.
		if ((window.getSelection()?.toString().length ?? 0) > 0) return;
		const pinned = nearBottom();
		await invalidateAll();
		if (pinned) requestAnimationFrame(scrollBottom);
	}

	onMount(() => {
		void claimShared();
		scrollBottom();
		store.start();
		document.addEventListener('visibilitychange', onVisibility);
		schedulePoll();
		return () => {
			store.stop();
			refreshGate.cancel();
			clearTimeout(poll);
			for (const timer of burst) clearTimeout(timer);
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
		busy = true;
		uncertain = null;
		try {
			const r = await fetch(`/api/agents/${encodeURIComponent(detail.paneId)}/answer`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ index })
			});
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
				uncertain = body?.message ?? `Could not answer (${r.status}).`;
			} else if (body?.outcome === 'unknown') {
				uncertain = `Sent "${body.chose}" but could not confirm it landed — check before sending again.`;
			}
		} catch (e) {
			uncertain = `Nothing was sent: ${(e as Error).message}. Check the connection and try again.`;
		} finally {
			busy = false;
		}
		refreshSoon();
	}

	/** Resolves to whether herdr took the keys; a refusal shows up as `sendError`. */
	async function sendKeys(keys: string[]): Promise<boolean> {
		sendError = null;
		try {
			const r = await fetch(`/api/agents/${encodeURIComponent(detail.paneId)}/keys`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ keys })
			});
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

	async function send() {
		if (!draft.trim() && attachments.length === 0) return;
		// Sending ends dictation: a still-listening engine would otherwise keep
		// writing the next sentence into the emptied composer. The mic is one
		// tap away if there is more to say.
		if (dictating) stopDictation();
		busy = true;
		sendError = null;
		try {
			if (attachments.length > 0) {
				const form = new FormData();
				for (const file of attachments) form.append('file', file);
				form.append('text', draft);
				let sent: Response;
				try {
					sent = await fetch(`/api/agents/${encodeURIComponent(detail.paneId)}/image`, {
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
				const sent = await fetch(`/api/agents/${encodeURIComponent(detail.paneId)}/prompt`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text: draft })
				});
				if (!sent.ok) throw await failure(sent, 'send');
			}
			// Only a delivered prompt clears the box; a refused one stays put
			// to be fixed or resent. Echo it first: herdr has accepted it, so
			// showing it is a statement of fact, not optimism.
			if (draft.trim())
				pendingSends = [...pendingSends, { id: ++pendingSeq, text: draft, at: Date.now() }];
			draft = '';
		} catch (e) {
			sendError = (e as Error).message;
		}
		busy = false;
		await invalidateAll();
		requestAnimationFrame(scrollBottom);
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

	function stop() {
		void sendKeys(['esc']);
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
		root.addEventListener('touchend', onTouchEnd, { passive: true });
		return () => {
			root.removeEventListener('touchstart', onTouchStart);
			root.removeEventListener('touchend', onTouchEnd);
		};
	});

	function onTouchStart(event: TouchEvent) {
		const touch = event.touches[0];
		if (!touch || event.touches.length > 1 || !prefs.value.swipeAgents) {
			tracking = false;
			return;
		}
		// A tool block or the screen peek scrolls sideways; it owns the gesture.
		tracking = !(swipeRoot && inHorizontalScroller(event.target, swipeRoot));
		startX = touch.clientX;
		startY = touch.clientY;
	}

	async function onTouchEnd(event: TouchEvent) {
		if (!tracking) return;
		tracking = false;
		const touch = event.changedTouches[0];
		if (!touch) return;
		const direction = decideSwipe(
			touch.clientX - startX,
			touch.clientY - startY,
			startX,
			window.innerWidth
		);
		if (!direction) return;
		const pane = neighbourPane(order, detail.paneId, direction);
		if (!pane) return;
		navigator.vibrate?.(20);
		// REPLACE, never push: swiping is moving along one list, not walking
		// deeper into it. Pushing meant that after five swipes the phone's back
		// gesture had to retrace all five before the agent list reappeared.
		// Back now always returns to where you came from; left swipe is how you
		// go to the previous agent.
		await goto(resolve('/a/[pane]', { pane }), { replaceState: true });
	}
</script>

<svelte:head><title>{detail.title || detail.paneId} · bordr</title></svelte:head>

{#snippet headerTitle()}
	<span class="block truncate text-[15px] font-semibold">{detail.title || detail.paneId}</span>
	<span class="block truncate font-mono text-[10.5px] text-muted">
		<span class={STATUS_INK[detail.status] ?? 'text-faint'}>● {detail.status}</span>
		·
		<span class={harnessText(detail.agent)}
			>{#if prefs.value.harnessIcons}<HarnessMark agent={detail.agent} />{/if}
			{detail.agent}</span
		>
		{#if detail.workspaceLabel}· {detail.workspaceLabel}{/if}
		{#if position >= 0 && order.length > 1}
			· {position + 1}/{order.length}
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
			class="flex h-8 shrink-0 items-center rounded-full px-2.5 text-[12px] {showWork
				? 'bg-working-bg text-working'
				: 'text-muted'}"
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
			class="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-edge px-3 text-[13px] font-medium"
			onclick={stop}
		>
			<span class="h-2 w-2 rounded-full bg-working ring-[3px] ring-working-halo" aria-hidden="true"
			></span>
			Stop
		</button>
	{/if}
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
			<WorkspaceTabs current={detail.paneId} panes={!(wideScreen && splitLayout)} />

			<!--
				Terminal mode lifts the footer off the screen itself, so the page's
				own copy would be the same rows twice.
			-->
			{#if detail.statusLines.length > 0 && prefs.value.statusPosition === 'header' && prefs.value.paneView !== 'terminal'}
				<StatusBlock
					rows={statusRows}
					agent={detail.agent}
					open={statusOpen}
					ontoggle={() => (statusOpen = !statusOpen)}
				/>
			{/if}
		</header>

		{#if prefs.value.paneView === 'terminal'}
			<!--
				Terminal mode: the pane exactly as the machine draws it, with a
				prompt line under it. The transcript view is the one that
				interprets; this one shows.
			-->
			<PaneTerminal
				paneId={detail.paneId}
				agent={detail.agent}
				ask={detail.picker && detail.picker.options.length > 0 ? pickerCard : undefined}
				bind:draft
				mono={prefs.value.monoSize}
				{dictating}
				{busy}
				onkeys={(keys) => void sendKeys(keys)}
				onmic={speechSupported ? toggleDictation : undefined}
			/>
		{:else}
			<main class="mx-auto w-full max-w-screen-sm flex-1 px-4 pt-3 pb-2 lg:max-w-3xl">
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

				{#if canShowEarlier}
					<div class="mb-3 flex justify-center">
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
								{#if prefs.value.bubbles}
									<div class="flex justify-end">
										<span
											class="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 [overflow-wrap:anywhere] whitespace-pre-wrap opacity-60"
											style="background:{prefs.bubbleColours.userBubble}; color:{prefs.bubbleColours
												.userText}">{sent.text}</span
										>
									</div>
								{:else}
									<div class="flex gap-2 opacity-60">
										<span
											class="shrink-0 font-mono text-[13px] leading-[1.7] text-working"
											aria-hidden="true">›</span
										>
										<span
											class="min-w-0 flex-1 font-medium [overflow-wrap:anywhere] whitespace-pre-wrap"
											>{sent.text}</span
										>
									</div>
								{/if}
								<p class="text-right text-[11px] text-faint">
									{detail.status === 'working' ? 'queued behind this turn' : 'sent'}
								</p>
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
										<div class="flex justify-end">
											<span
												class="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 [overflow-wrap:anywhere] whitespace-pre-wrap"
												style="background:{prefs.bubbleColours.userBubble}; color:{prefs
													.bubbleColours.userText}"
											>
												<MessageBlocks
													blocks={message.blocks ?? []}
													mono={prefs.value.monoSize}
													plain
												/>
											</span>
										</div>
									{:else}
										<div class="flex gap-2">
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
										</div>
									{/if}
								{:else if message.text || (showWork && (message.blocks?.length ?? 0) > 0)}
									<!-- A turn that is only tool calls has nothing to show while the
								     work is hidden; rendering the prefix anyway left a column of
								     bare dots separated by empty space. -->
									<div class="flex gap-2">
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
												{#if prose(message).length > 0}
													<div
														class="max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2 [overflow-wrap:anywhere]"
														style="background:{agentBubbleColour}; color:{prefs.bubbleColours
															.agentText}{agentEdge
															? `; border-left:3px solid ${agentEdge}; border-top-left-radius:6px; border-bottom-left-radius:6px`
															: ''}"
													>
														<MessageBlocks blocks={prose(message)} mono={prefs.value.monoSize} />
													</div>
												{/if}
												<MessageBlocks
													blocks={work(message)}
													mono={prefs.value.monoSize}
													{showWork}
												/>
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

			<div class="sticky bottom-0 z-10">
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
							onclick={() => scrollBottom()}
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

					{#if sendError}
						<p
							role="status"
							class="mb-2 rounded-[10px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger-ink"
						>
							{sendError}
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
						<textarea
							bind:this={textarea}
							bind:value={draft}
							onkeydown={onKeydown}
							onpaste={onPaste}
							rows="1"
							placeholder={isShell
								? 'Runs on the host…'
								: detail.picker
									? 'Or type a reply…'
									: 'Type a reply…'}
							class="[field-sizing:content] max-h-[min(10rem,22dvh)] min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[16px] placeholder:text-faint focus:outline-none"
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
							<Icon name="arrow-up" size={19} />
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
				{#if detail.statusLines.length > 0 && prefs.value.statusPosition === 'bottom'}
					<div class="border-t border-hairline bg-page pt-1.5">
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
	{#if detail.picker && detail.picker.options.length > 0}
		<section
			class="mt-4 flex overflow-hidden rounded-xl border border-blocked-edge bg-blocked-surface shadow-[0_6px_18px_rgba(217,119,6,.10)]"
		>
			<span class="w-1 shrink-0 self-stretch bg-blocked"></span>
			<div class="min-w-0 flex-1 p-3">
				<p class="font-mono text-[10.5px] tracking-[.3px] text-blocked-ink">
					? WAITING ON YOU{detail.picker.multi ? ' · MULTI-SELECT' : ''}
				</p>
				{#if detail.picker.question}
					<p class="mt-1.5 text-[15px]">{detail.picker.question}</p>
				{/if}
				<div class="mt-2 flex flex-col gap-1.5">
					{#each detail.picker.options as option (option.index)}
						<button
							class="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[14px] disabled:opacity-50 {detail
								.picker.multi
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
						class="mt-2.5 w-full rounded-lg bg-ink py-3 text-[14px] font-medium text-card disabled:opacity-50"
						disabled={busy}
						onclick={() => sendKeys(['enter'])}
					>
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
		<PaneScreen {paneId} onopen={() => goto(resolve('/a/[pane]', { pane: paneId }))} />
	{/if}
{/snippet}

{#snippet paneHeader()}
	<AppHeader
		onmenu={() =>
			wideScreen ? prefs.set('sidebarOpen', !prefs.value.sidebarOpen) : (treeOpen = true)}
		menuLabel={wideScreen
			? prefs.value.sidebarOpen
				? 'Hide the session list'
				: 'Show the session list'
			: 'Session list'}
		menuExpanded={wideScreen ? prefs.value.sidebarOpen : treeOpen}
		middle={headerTitle}
		actions={headerActions}
	/>
{/snippet}

<!--
	Desktop adds a session tree beside the conversation; the phone gets
	exactly what it had. Everything is one breakpoint — there is no second
	conversation component to keep in step, which is what makes this safe.
-->
<div class="lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden">
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
			<aside class="hidden w-[276px] shrink-0 lg:block">
				<SessionTree current={detail.paneId} onnew={() => (showNewAgent = true)} />
			</aside>
		{/if}

		<!--
		The same tree as a drawer below lg. One component, so the phone and the
		desktop can never drift; only how it is presented changes.
	-->
		{#if treeOpen}
			<div class="fixed inset-0 z-40 lg:hidden">
				<button
					class="absolute inset-0 bg-black/40"
					aria-label="Close the session list"
					onclick={() => (treeOpen = false)}
				></button>
				<div class="absolute inset-y-0 left-0 w-[86%] max-w-[320px] shadow-2xl">
					<SessionTree
						current={detail.paneId}
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
</div>

<style>
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
