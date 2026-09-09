<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { agentStore } from '$lib/agents.svelte';
	import { mergeResults } from '$lib/dictation';
	import { shrinkImage } from '$lib/shrink-image';
	import { prefs } from '$lib/prefs.svelte';
	import { flatOrder } from '$lib/grouping';
	import { decideSwipe, inHorizontalScroller, neighbourPane } from '$lib/swipe';
	import { harnessBorder, harnessBubble, harnessText, STATUS_INK } from '$lib/theme';
	import { ansiToHtml } from '$lib/ansi';
	import { termGrid } from '$lib/term-grid';
	import { throttleTrailing } from '$lib/throttle';
	import { rankCommands, type SlashCommand } from '$lib/commands';
	import Icon from '$lib/components/icon.svelte';
	import MessageBlocks from '$lib/components/message-blocks.svelte';
	let { data } = $props();

	const TAIL = 80;

	/**
	 * Tool calls, results and thinking. Starts from the persisted preference
	 * so the choice survives leaving the conversation — it used to reset to
	 * hidden on every open, which made the work look like it was not there.
	 */
	let showWork = $state(prefs.value.showWork);
	/**
	 * The manual harness controls: the screen peek and the key strip together.
	 * They belong together — you press a key and watch the screen react — and
	 * the ⌨ button is what shows and hides them. `keyStrip` in Settings only
	 * decides whether they start open.
	 */
	let showControls = $state(prefs.value.keyStrip === 'always');
	let draft = $state('');
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
		fetch(`/api/agents/${pane}/commands`)
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
	let fileInput: HTMLInputElement | undefined;
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
	 * The agent bubble, tinted with this harness's accent unless a colour has
	 * been picked by hand. A picked colour always wins: it is an explicit
	 * choice and must not be second-guessed per harness.
	 */
	const agentBubbleColour = $derived(
		prefs.value.agentBubble ||
			(prefs.value.harnessBubbles
				? harnessBubble(
						detail.agent,
						prefs.resolvedTheme === 'dark',
						prefs.bubbleColours.agentBubble
					)
				: prefs.bubbleColours.agentBubble)
	);
	const watched = $derived(data.watched);
	const visibleMessages = $derived(detail.messages.slice(-shown));
	const hidden = $derived(Math.max(0, detail.messages.length - shown));
	const canShowEarlier = $derived(hidden > 0 || detail.hasMore);
	const toolCount = $derived(visibleMessages.reduce((n, m) => n + m.tools.length, 0));

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
	let pendingSends = $state<{ id: number; text: string }[]>([]);
	let pendingSeq = 0;

	$effect(() => {
		if (pendingSends.length === 0) return;
		// Matched on text rather than order: a queued prompt can land after a
		// later one, and the harness may rewrite the tail as it goes.
		const landed = new Set(
			detail.messages.filter((m) => m.role === 'user').map((m) => m.text.trim())
		);
		const still = pendingSends.filter((p) => !landed.has(p.text.trim()));
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

	async function addFiles(input: HTMLInputElement) {
		const picked = [...(input.files ?? [])].slice(0, 6 - attachments.length);
		// Cleared so the same photo can be picked again after a removal —
		// an unchanged selection fires no change event.
		input.value = '';
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
		const response = await fetch(`/api/agents/${detail.paneId}/watch`, {
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

	function scrollBottom() {
		window.scrollTo({ top: document.body.scrollHeight });
	}

	function nearBottom(): boolean {
		return window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
	}

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
			const r = await fetch(`/api/agents/${detail.paneId}/read?lines=${lines}&ansi=1`);
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
			const r = await fetch(`/api/agents/${detail.paneId}/answer`, {
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
			const r = await fetch(`/api/agents/${detail.paneId}/keys`, {
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
					sent = await fetch(`/api/agents/${detail.paneId}/image`, { method: 'POST', body: form });
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
				const sent = await fetch(`/api/agents/${detail.paneId}/prompt`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ text: draft })
				});
				if (!sent.ok) throw await failure(sent, 'send');
			}
			// Only a delivered prompt clears the box; a refused one stays put
			// to be fixed or resent. Echo it first: herdr has accepted it, so
			// showing it is a statement of fact, not optimism.
			if (draft.trim()) pendingSends = [...pendingSends, { id: ++pendingSeq, text: draft }];
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

<div class="flex min-h-dvh flex-col" bind:this={swipeRoot}>
	<header class="sticky top-0 z-10 border-b border-hairline bg-page">
		<div class="flex items-center gap-1 px-2 pt-1 pb-1.5">
			<a
				href={resolve('/')}
				class="flex h-10 w-10 shrink-0 items-center justify-center font-mono text-base text-working"
				aria-label="Back to agents">←</a
			>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-[16px] font-semibold">{detail.title || detail.paneId}</span
				>
				<span class="block truncate font-mono text-[10.5px] text-muted">
					<span class={STATUS_INK[detail.status] ?? 'text-faint'}>● {detail.status}</span>
					· <span class={harnessText(detail.agent)}>{detail.agent}</span>
					{#if detail.workspaceLabel}· {detail.workspaceLabel}{/if}
					{#if position >= 0 && order.length > 1}
						· {position + 1}/{order.length}
					{/if}
				</span>
			</span>
			{#if detail.status === 'working'}
				<button
					class="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-edge px-3 text-[13px] font-medium"
					onclick={stop}
				>
					<span
						class="h-2 w-2 rounded-full bg-working ring-[3px] ring-working-halo"
						aria-hidden="true"
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
		</div>

		{#if detail.statusLines.length > 0}
			<button
				class="flex w-full items-center gap-1 px-4 pb-1.5 text-left font-mono text-[10px] text-muted"
				onclick={() => (statusOpen = !statusOpen)}
			>
				{#if statusOpen}
					<span class="whitespace-pre-wrap">{detail.statusLines.join('\n')}</span>
				{:else}
					<span class="min-w-0 flex-1 truncate">{detail.statusLines[0]}</span>
					<span aria-hidden="true">▾</span>
				{/if}
			</button>
		{/if}
	</header>

	<main class="flex-1 px-4 pt-3 pb-2">
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
					{loadingBack ? 'Loading…' : scrollback === null ? 'Load scrollback' : 'Reload scrollback'}
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
				{#each visibleMessages as message, i (detail.messages.length - visibleMessages.length + i)}
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
									style="background:{prefs.bubbleColours.userBubble}; color:{prefs.bubbleColours
										.userText}"
								>
									<MessageBlocks blocks={message.blocks ?? []} mono={prefs.value.monoSize} plain />
								</span>
							</div>
						{:else}
							<div class="flex gap-2">
								<span
									class="shrink-0 font-mono text-[13px] leading-[1.7] text-working"
									aria-hidden="true">›</span
								>
								<span class="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">
									<MessageBlocks blocks={message.blocks ?? []} mono={prefs.value.monoSize} plain />
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
									class="shrink-0 font-mono text-[13px] leading-[1.7] {harnessText(detail.agent)}"
									aria-hidden="true">·</span
								>
							{/if}
							<div class="min-w-0 flex-1">
								{#if prefs.value.bubbles}
									<div
										class="max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2 [overflow-wrap:anywhere]"
										style="background:{agentBubbleColour}; color:{prefs.bubbleColours.agentText}"
									>
										<MessageBlocks
											blocks={message.blocks ?? []}
											mono={prefs.value.monoSize}
											{showWork}
										/>
									</div>
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
				{/each}

				{#if detail.status === 'working'}
					<div class="ml-[22px] flex items-center gap-1.5 font-mono text-[11px] text-muted">
						{#each [0, 1, 2] as n (n)}
							<span
								class="h-1 w-1 rounded-full bg-working motion-safe:animate-[bordr-pulse_1.2s_ease-in-out_infinite]"
								style="animation-delay: {n * 0.2}s; opacity: {1 - n * 0.35}"
							></span>
						{/each}
						working
					</div>
				{/if}

				<!--
					Sent, accepted by herdr, not yet in the transcript.

					BELOW the working indicator, which is where the terminal puts
					it: the agent is still finishing the turn above, and your
					prompt is waiting behind it. Above the spinner it read as
					though it had already been picked up.
				-->
				{#each pendingSends as sent (sent.id)}
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
							<span class="min-w-0 flex-1 font-medium [overflow-wrap:anywhere] whitespace-pre-wrap"
								>{sent.text}</span
							>
						</div>
					{/if}
					<p class="text-right text-[11px] text-faint">
						{detail.status === 'working' ? 'queued behind this turn' : 'sent'}
					</p>
				{/each}
			{/if}

			{#if toolCount > 0}
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
		class="sticky bottom-0 z-10 border-t border-hairline bg-page px-3 py-2.5"
		style="padding-bottom: max(0.625rem, env(safe-area-inset-bottom))"
	>
		<!--
			The harness's own ghost prompt. Tapping fills the box rather than
			sending: on a phone you cannot see what you are about to commit to
			the way you can in a terminal, and it is usually a starting point
			worth editing. Hidden the moment you type anything of your own.
		-->
		{#if detail.suggestion && draft.trim() === ''}
			<button
				class="mb-2 flex w-full items-center gap-2 rounded-xl border border-hairline bg-card px-3 py-2 text-left"
				onclick={() => {
					draft = detail.suggestion ?? '';
					textarea?.focus();
				}}
			>
				<span class="shrink-0 text-[13px] text-faint" aria-hidden="true">&rarr;</span>
				<span class="min-w-0 flex-1 truncate text-[14px] text-muted">{detail.suggestion}</span>
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
				<span class="shrink-0 font-mono text-[11px] text-faint">{attachments.length} / 6</span>
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
								<span class="shrink-0 font-mono text-[10px] text-faint">{command.source}</span>
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

		<div class="flex items-end gap-1.5 rounded-xl border border-edge bg-card p-2">
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
				rows="1"
				placeholder={detail.picker ? 'Or type a reply…' : 'Type a reply…'}
				class="[field-sizing:content] max-h-40 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[16px] placeholder:text-faint focus:outline-none"
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
			<div class="mt-2 grid grid-cols-8 gap-[5px]">
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
