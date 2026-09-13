import { browser } from '$app/environment';
import { DEFAULT_FILL, DEFAULT_USER } from './bubble-colour';
import { parseHex, readableTextOn } from '$lib/contrast';
import type { ListFilter } from './grouping';
import { clampSidebar, DEFAULT_SIDEBAR } from './sidebar';

export type GroupBy = 'workspace' | 'status' | 'harness' | 'none';
export type SortBy = 'status-title' | 'title' | 'recent';
export type PreviewMode = 'activity' | 'cwd' | 'none';
export type Theme = 'light' | 'dark' | 'system';
export type KeyStripMode = 'always' | 'peek';
export type BackTo = 'home' | 'history';

/**
 * How often a bubble carries the time.
 *
 *   off   never
 *   runs  once per run of turns from the same speaker, on its last bubble —
 *         a burst of five replies in the same minute gets one stamp, not five
 *   all   every bubble
 */
export type MessageTime = 'off' | 'runs' | 'all';

/**
 * Which sub-agents the strip above a conversation carries.
 *
 *   off       none; the Task rows in the transcript still open them
 *   running   only the ones still working, with the finished behind a count
 *   all       every sub-agent this session has ever spawned
 */
export type SubagentStrip = 'off' | 'running' | 'all';

/**
 * What the drawer offers for getting home, on a phone.
 *
 * The drawer covers the whole screen, header included, so the mark in the
 * header — which is a link to the agents list — cannot be reached while it is
 * open. Something in the drawer has to stand in for it.
 *
 *   mark  the collie, the same control as the header's
 *   icon  a plain home glyph
 *   off   nothing; close the drawer and use the header
 */
export type DrawerHome = 'mark' | 'icon' | 'off';

/**
 * The model, and how hard it is being asked to think, in the header.
 *
 * Both are already in the harness's status block, but that is a dense row of
 * glyphs and quotas you read when you go looking. These two change what an
 * answer is worth and what it costs, so they are worth a glance rather than a
 * hunt.
 */
export type HeaderModel = 'off' | 'model' | 'model-effort';

/** Which clock a time is written on, when the locale's own is not wanted. */
export type ClockFormat = 'auto' | 'h24' | 'h12';

/** Whether the app makes a noise when an agent's state changes. */
export type SoundAlerts = 'off' | 'attention' | 'all';

/** How a status shows in the sidebar — herdr's own `status_indicators`. */
export type StatusIndicators = 'dot' | 'symbol' | 'text';

/**
 * Where a harness's own colour lands on its bubble.
 *
 *   edge  the border only
 *   tint  the border, and a faint blend of it in the fill
 *   fill  the border, and the fill AT FULL STRENGTH — the loudest option,
 *         and the only one that has to re-pick the text colour to stay
 *         readable on it
 *   off   nowhere; the border falls back to the neutral edge
 */
export type HarnessAccent = 'edge' | 'tint' | 'fill' | 'off';

/** A fill is laid flat, or fades away from the speaker's own tail corner. */
export type FillStyle = 'solid' | 'gradient';

/**
 * What the far end of a fill gradient fades TO.
 *
 *   auto     derived from the fill so the text stays readable by construction
 *   harness  the agent's own colour, so the bubble carries who is speaking
 *   custom   a colour picked below
 */
export type GradientEnd = 'auto' | 'harness' | 'custom';

/*
 * A bubble's fill and its border are independent: either, both, or neither.
 * Border alone is the outline look, fill alone is the older solid bubble,
 * both gives a filled bubble with a rule, and neither leaves the text bare
 * on the page. Each has its own colour per side.
 */
export type ToolDetail = 'formatted' | 'json';
export type PaneView = 'auto' | 'conversation' | 'terminal';
export type TerminalFit = 'fit' | 'wrap' | 'native';
export type TerminalDensity = 'compact' | 'comfortable';

export type AgentOrder = 'priority' | 'workspace';
export type StatusPosition = 'header' | 'bottom';
export type WorkControl = 'inline' | 'header';

export interface Prefs {
	v: number;
	groupBy: GroupBy;
	/**
	 * The badge at the top of the list that is lit, narrowing it to one status
	 * or to panes with unpushed work. Null is the whole list.
	 *
	 * Persisted, and not only so it survives a reload: the conversation swipes
	 * through `flatOrder`, which must walk the list you can actually see. A
	 * page-local filter would leave "next" stepping onto rows that are not on
	 * screen.
	 */
	listFilter: ListFilter | null;
	sort: SortBy;
	/**
	 * What the phone's back gesture does from inside an agent.
	 *
	 * 'home': moving between panes, tabs and screens from an agent REPLACES
	 * the history entry, so back is always one step to the agents list. That
	 * is what the gesture is for on a phone, and a swipe or the tab strip is
	 * how you move sideways.
	 *
	 * 'history': every move pushes, and back retraces them one at a time. Ten
	 * gestures to get home after a few minutes of switching is the behaviour
	 * this option exists to restore, for anyone who wants it.
	 */
	backTo: BackTo;
	/**
	 * The grouping chips on `/`. They used to appear only after grouping had
	 * been changed in Settings, which meant they were invisible on a fresh
	 * load and looked like a bug. Visible by default, and switchable.
	 */
	showGrouping: boolean;
	rollup: boolean;
	preview: PreviewMode;
	theme: Theme;
	monoSize: number;
	keyStrip: KeyStripMode;
	/** Show tool calls, results and thinking in a conversation by default. */
	showWork: boolean;
	/**
	 * How the harness's accent reaches a bubble. 'edge' is a stripe down the
	 * side; 'tint' blends it into the background, which muddies every theme
	 * colour it touches; 'off' leaves the bubble alone.
	 */
	harnessAccent: HarnessAccent;
	statusIndicators: StatusIndicators;
	soundAlerts: SoundAlerts;
	/** Collapse a run of tool-only turns into one expandable group. */
	groupTools: boolean;
	bubbleFill: boolean;
	fillStyle: FillStyle;
	gradientEnd: GradientEnd;
	userGradientEnd: string;
	agentGradientEnd: string;
	/** A bubble's pointer. Off leaves the squared corner and nothing else. */
	bubbleTails: boolean;
	bubbleBorder: boolean;
	/** Rule thickness in px. */
	bubbleBorderWidth: number;
	userBorder: string;
	agentBorder: string;
	/** Render a tool call the way a terminal shows it, or as raw JSON. */
	toolDetail: ToolDetail;
	/** How the sidebar's agent section is ordered: by urgency, or by workspace. */
	agentOrder: AgentOrder;
	/**
	 * How much of the sidebar the workspaces section takes, 0.15 to 0.75.
	 * Dragged by the divider between the two sections.
	 */
	sidebarSplit: number;
	/**
	 * How wide the desktop sidebar is, in pixels. Dragged by its right edge,
	 * clamped by the resizer so a stored value from anywhere cannot make it
	 * unusable.
	 */
	sidebarWidth: number;
	/** The desktop session tree, open or collapsed out of the way. */
	sidebarOpen: boolean;
	/** Draw a tab's panes as herdr's real split, rather than one pane at a time. */
	splitPanes: boolean;
	/**
	 * A pane as its transcript, or as the terminal screen with a prompt line.
	 * 'auto' picks per pane: a shell has no transcript to render.
	 */
	paneView: PaneView;
	/** How a screen wider than the window is made to fit it. */
	terminalFit: TerminalFit;
	/** How tightly the terminal's rows are packed. */
	terminalDensity: TerminalDensity;
	/** The harness's status row, and where the terminal is looking, on each list row. */
	listDetail: boolean;
	/** The git branch under each workspace in the tree. */
	/**
	 * Delivery marks on your own messages: a spinner while the request is in
	 * flight, one tick once herdr has it, two once the agent has picked it up.
	 */
	/**
	 * Put the number of agents waiting on the app's own icon.
	 *
	 * A notification cannot still be there tomorrow; a badge can — which is
	 * the argument for it and, for anyone who keeps a clean home screen, the
	 * argument against.
	 */
	appBadge: boolean;
	messageTicks: boolean;
	/** How often a bubble carries the time it was written. */
	messageTime: MessageTime;
	/** Which sub-agents appear in the strip above a conversation. */
	subagentStrip: SubagentStrip;
	/** What the phone drawer offers for getting back to the agents list. */
	drawerHome: DrawerHome;
	/** The model and effort on the conversation header's location row. */
	headerModel: HeaderModel;
	/** Which clock that time is written on; 'auto' follows the device. */
	clockFormat: ClockFormat;
	/** The herdr tab name on list rows and in the sidebar. */
	showTabName: boolean;
	showBranches: boolean;
	/** Name an unnamed tab after what is in it, rather than "tab 2". */
	smartTabLabels: boolean;
	/** Render the harness's live verb, elapsed time and tokens while it works. */
	showActivity: boolean;
	/** A glyph beside each harness name. */
	harnessIcons: boolean;
	/** Colour code, diffs and tool input with VS Code's grammars. */
	syntaxHighlight: boolean;
	/** Photos collapse to a strip until tapped. */
	compactImages: boolean;
	/** Offer the harness's own ghost prompt above the composer. */
	showSuggestions: boolean;
	/**
	 * Where the harness's status block sits. 'bottom' puts it under the
	 * composer, where the on-screen keyboard covers it instead of the
	 * conversation.
	 */
	statusPosition: StatusPosition;
	/** Where the show-the-work control lives: with the transcript, or in the header. */
	workControl: WorkControl;
	/**
	 * Which status row to show when the block is collapsed, per harness.
	 * A claude pane and a codex pane care about different lines.
	 */
	statusLine: Record<string, number>;
	enterSends: boolean;
	dictationLang: string;
	/**
	 * Keep dictating until the stop button, restarting the engine every time
	 * it gives up on a pause. Off stops at the first pause, which suits a
	 * one-line reply.
	 */
	dictationHold: boolean;
	/** Swipe across a conversation to cycle agents. Not everyone wants it. */
	swipeAgents: boolean;
	/** Bubble styling for the transcript, WhatsApp-style, instead of prefixes. */
	bubbles: boolean;
	userBubble: string;
	userText: string;
	agentBubble: string;
	agentText: string;
}

export const DEFAULTS: Prefs = {
	v: 2,
	groupBy: 'workspace',
	listFilter: null,
	sort: 'status-title',
	backTo: 'home',
	showGrouping: true,
	rollup: true,
	preview: 'activity',
	theme: 'system',
	monoSize: 11,
	keyStrip: 'peek',
	showWork: true,
	harnessAccent: 'edge',
	statusIndicators: 'dot',
	soundAlerts: 'attention',
	groupTools: true,
	bubbleFill: false,
	fillStyle: 'gradient',
	gradientEnd: 'auto',
	userGradientEnd: '',
	agentGradientEnd: '',
	bubbleTails: true,
	bubbleBorder: true,
	bubbleBorderWidth: 2,
	userBorder: '',
	agentBorder: '',
	toolDetail: 'formatted',
	agentOrder: 'priority',
	sidebarSplit: 0.4,
	sidebarWidth: DEFAULT_SIDEBAR,
	sidebarOpen: true,
	splitPanes: true,
	paneView: 'auto',
	terminalFit: 'fit',
	terminalDensity: 'comfortable',
	listDetail: true,
	appBadge: true,
	messageTicks: true,
	messageTime: 'runs',
	subagentStrip: 'running',
	drawerHome: 'mark',
	headerModel: 'model-effort',
	clockFormat: 'auto',
	showTabName: true,
	showBranches: true,
	smartTabLabels: true,
	showActivity: true,
	harnessIcons: true,
	syntaxHighlight: true,
	compactImages: true,
	showSuggestions: true,
	statusPosition: 'header',
	workControl: 'inline',
	statusLine: {},
	enterSends: false,
	dictationLang: 'en-GB',
	dictationHold: true,
	swipeAgents: true,
	bubbles: false,
	/**
	 * Empty means "follow the theme" — see `bubbleColours`. No single hex works
	 * in both: a light agent bubble is legible on the dark page but nearly
	 * invisible against the light one, which is `#f4f5f7`. A picker writes a
	 * concrete value and that wins from then on.
	 */
	userBubble: '',
	userText: '',
	agentBubble: '',
	agentText: ''
};

const KEY = 'bordr-prefs';
/**
 * Bumped when a DEFAULT changes in a way an existing install must pick up.
 * Every field is validated regardless, so this only gates the few that
 * deliberately reset.
 */
const VERSION = 2;
const GROUPS: GroupBy[] = ['workspace', 'status', 'harness', 'none'];
const FILTERS: ListFilter[] = ['blocked', 'working', 'done', 'idle', 'unknown', 'dirty'];
const SORTS: SortBy[] = ['status-title', 'title', 'recent'];
const PREVIEWS: PreviewMode[] = ['activity', 'cwd', 'none'];
const THEMES: Theme[] = ['light', 'dark', 'system'];
const STRIPS: KeyStripMode[] = ['always', 'peek'];
const BACKS: BackTo[] = ['home', 'history'];
const MESSAGE_TIMES: MessageTime[] = ['off', 'runs', 'all'];
const SUBAGENT_STRIPS: SubagentStrip[] = ['off', 'running', 'all'];
const DRAWER_HOMES: DrawerHome[] = ['mark', 'icon', 'off'];
const HEADER_MODELS: HeaderModel[] = ['off', 'model', 'model-effort'];
const CLOCKS: ClockFormat[] = ['auto', 'h24', 'h12'];
const ACCENTS: HarnessAccent[] = ['edge', 'tint', 'fill', 'off'];
const INDICATORS: StatusIndicators[] = ['dot', 'symbol', 'text'];
const SOUNDS: SoundAlerts[] = ['off', 'attention', 'all'];
const FILL_STYLES: FillStyle[] = ['solid', 'gradient'];
const GRADIENT_ENDS: GradientEnd[] = ['auto', 'harness', 'custom'];
const TOOL_DETAILS: ToolDetail[] = ['formatted', 'json'];
const AGENT_ORDERS: AgentOrder[] = ['priority', 'workspace'];
const STATUS_POSITIONS: StatusPosition[] = ['header', 'bottom'];
const WORK_CONTROLS: WorkControl[] = ['inline', 'header'];
const PANE_VIEWS: PaneView[] = ['auto', 'conversation', 'terminal'];
const TERMINAL_FITS: TerminalFit[] = ['fit', 'wrap', 'native'];
const TERMINAL_DENSITIES: TerminalDensity[] = ['compact', 'comfortable'];

function pick<T extends string | number>(value: unknown, allowed: T[], fallback: T): T {
	return allowed.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

/**
 * Only a real hex colour survives — anything else would reach an inline
 * `style` unchecked. Empty is allowed and means "follow the theme".
 */
function colour(value: unknown, fallback: string): string {
	if (value === '') return '';
	return typeof value === 'string' && parseHex(value) ? value : fallback;
}

/**
 * Merge stored prefs over the defaults, field by field.
 *
 * Anything unrecognised falls back rather than propagating: a hand-edited or
 * half-written localStorage entry must not be able to put the UI into a state
 * with no way back to Settings. A different `v` is read on the same terms —
 * every field is validated anyway, so a version bump costs nothing.
 */
export function normalisePrefs(raw: unknown): Prefs {
	if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS };
	const stored = raw as Partial<Record<keyof Prefs, unknown>>;
	const size = Number(stored.monoSize);
	return {
		v: VERSION,
		groupBy: pick(stored.groupBy, GROUPS, DEFAULTS.groupBy),
		// Null, not a fallback filter: an unrecognised value must open the whole
		// list, never silently hide rows the reader did not ask to hide.
		listFilter: FILTERS.includes(stored.listFilter as ListFilter)
			? (stored.listFilter as ListFilter)
			: null,
		sort: pick(stored.sort, SORTS, DEFAULTS.sort),
		backTo: pick(stored.backTo, BACKS, DEFAULTS.backTo),
		showGrouping: bool(stored.showGrouping, DEFAULTS.showGrouping),
		rollup: bool(stored.rollup, DEFAULTS.rollup),
		preview: pick(stored.preview, PREVIEWS, DEFAULTS.preview),
		theme: pick(stored.theme, THEMES, DEFAULTS.theme),
		// The Settings slider offers 10-13; anything else is not renderable text.
		monoSize: Number.isFinite(size)
			? Math.min(Math.max(Math.round(size), 10), 13)
			: DEFAULTS.monoSize,
		// One-time migration: the manual controls used to default to Open, and
		// a stored 'always' would otherwise outlive the change forever — a
		// default is only ever read when nothing is stored.
		keyStrip:
			stored.v === VERSION ? pick(stored.keyStrip, STRIPS, DEFAULTS.keyStrip) : DEFAULTS.keyStrip,
		showWork: bool(stored.showWork, DEFAULTS.showWork),
		harnessAccent: pick(stored.harnessAccent, ACCENTS, DEFAULTS.harnessAccent),
		statusIndicators: pick(stored.statusIndicators, INDICATORS, DEFAULTS.statusIndicators),
		soundAlerts: pick(stored.soundAlerts, SOUNDS, DEFAULTS.soundAlerts),
		groupTools: bool(stored.groupTools, DEFAULTS.groupTools),
		bubbleFill: bool(stored.bubbleFill, DEFAULTS.bubbleFill),
		fillStyle: pick(stored.fillStyle, FILL_STYLES, DEFAULTS.fillStyle),
		gradientEnd: pick(stored.gradientEnd, GRADIENT_ENDS, DEFAULTS.gradientEnd),
		userGradientEnd: colour(stored.userGradientEnd, DEFAULTS.userGradientEnd),
		agentGradientEnd: colour(stored.agentGradientEnd, DEFAULTS.agentGradientEnd),
		bubbleTails: bool(stored.bubbleTails, DEFAULTS.bubbleTails),
		bubbleBorder: bool(stored.bubbleBorder, DEFAULTS.bubbleBorder),
		bubbleBorderWidth: pick(
			Number(stored.bubbleBorderWidth),
			[1, 2, 3],
			DEFAULTS.bubbleBorderWidth
		),
		userBorder: colour(stored.userBorder, DEFAULTS.userBorder),
		agentBorder: colour(stored.agentBorder, DEFAULTS.agentBorder),
		toolDetail: pick(stored.toolDetail, TOOL_DETAILS, DEFAULTS.toolDetail),
		// Clamped on read: it comes from storage a person can hand-edit, and a
		// value outside this range collapses one section to nothing.
		agentOrder: pick(stored.agentOrder, AGENT_ORDERS, DEFAULTS.agentOrder),
		sidebarSplit:
			typeof stored.sidebarSplit === 'number' && Number.isFinite(stored.sidebarSplit)
				? Math.min(Math.max(stored.sidebarSplit, 0.15), 0.75)
				: DEFAULTS.sidebarSplit,
		sidebarWidth: clampSidebar(
			typeof stored.sidebarWidth === 'number' ? stored.sidebarWidth : DEFAULTS.sidebarWidth
		),
		sidebarOpen: bool(stored.sidebarOpen, DEFAULTS.sidebarOpen),
		splitPanes: bool(stored.splitPanes, DEFAULTS.splitPanes),
		paneView: pick(stored.paneView, PANE_VIEWS, DEFAULTS.paneView),
		terminalFit: pick(stored.terminalFit, TERMINAL_FITS, DEFAULTS.terminalFit),
		terminalDensity: pick(stored.terminalDensity, TERMINAL_DENSITIES, DEFAULTS.terminalDensity),
		listDetail: bool(stored.listDetail, DEFAULTS.listDetail),
		appBadge: bool(stored.appBadge, DEFAULTS.appBadge),
		messageTicks: bool(stored.messageTicks, DEFAULTS.messageTicks),
		messageTime: pick(stored.messageTime, MESSAGE_TIMES, DEFAULTS.messageTime),
		subagentStrip: pick(stored.subagentStrip, SUBAGENT_STRIPS, DEFAULTS.subagentStrip),
		drawerHome: pick(stored.drawerHome, DRAWER_HOMES, DEFAULTS.drawerHome),
		headerModel: pick(stored.headerModel, HEADER_MODELS, DEFAULTS.headerModel),
		clockFormat: pick(stored.clockFormat, CLOCKS, DEFAULTS.clockFormat),
		showTabName: bool(stored.showTabName, DEFAULTS.showTabName),
		showBranches: bool(stored.showBranches, DEFAULTS.showBranches),
		smartTabLabels: bool(stored.smartTabLabels, DEFAULTS.smartTabLabels),
		showActivity: bool(stored.showActivity, DEFAULTS.showActivity),
		harnessIcons: bool(stored.harnessIcons, DEFAULTS.harnessIcons),
		syntaxHighlight: bool(stored.syntaxHighlight, DEFAULTS.syntaxHighlight),
		compactImages: bool(stored.compactImages, DEFAULTS.compactImages),
		showSuggestions: bool(stored.showSuggestions, DEFAULTS.showSuggestions),
		statusPosition: pick(stored.statusPosition, STATUS_POSITIONS, DEFAULTS.statusPosition),
		workControl: pick(stored.workControl, WORK_CONTROLS, DEFAULTS.workControl),
		// Numbers only, and only sane ones: this is read back from storage a
		// person can hand-edit, and an out-of-range index would blank the row.
		statusLine: Object.fromEntries(
			Object.entries((stored.statusLine ?? {}) as Record<string, unknown>).filter(
				([, v]) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 12
			)
		) as Record<string, number>,
		enterSends: bool(stored.enterSends, DEFAULTS.enterSends),
		dictationLang:
			typeof stored.dictationLang === 'string' && stored.dictationLang.trim()
				? stored.dictationLang.trim()
				: DEFAULTS.dictationLang,
		dictationHold: bool(stored.dictationHold, DEFAULTS.dictationHold),
		swipeAgents: bool(stored.swipeAgents, DEFAULTS.swipeAgents),
		bubbles: bool(stored.bubbles, DEFAULTS.bubbles),
		userBubble: colour(stored.userBubble, DEFAULTS.userBubble),
		userText: colour(stored.userText, DEFAULTS.userText),
		agentBubble: colour(stored.agentBubble, DEFAULTS.agentBubble),
		agentText: colour(stored.agentText, DEFAULTS.agentText)
	};
}

/** Which theme to actually paint, given the pref and the OS setting. */
export function resolveTheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
	if (theme === 'system') return prefersDark ? 'dark' : 'light';
	return theme;
}

function load(): Prefs {
	if (!browser) return { ...DEFAULTS };
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? normalisePrefs(JSON.parse(raw)) : { ...DEFAULTS };
	} catch {
		// Private mode, blocked storage, or corrupt JSON — defaults still work.
		return { ...DEFAULTS };
	}
}

function createPrefs() {
	let current = $state<Prefs>(load());
	/** Tracked separately so `system` re-resolves when the OS flips. */
	let prefersDark = $state(false);

	function persist() {
		if (!browser) return;
		try {
			localStorage.setItem(KEY, JSON.stringify(current));
		} catch {
			// Storage unavailable — the session still honours the change.
		}
	}

	return {
		get value(): Prefs {
			return current;
		},
		get resolvedTheme(): 'light' | 'dark' {
			return resolveTheme(current.theme, prefersDark);
		},
		/** Bubble colours with the theme defaults filled in for anything unset. */
		get bubbleColours(): {
			userBubble: string;
			userText: string;
			agentBubble: string;
			agentText: string;
		} {
			const dark = resolveTheme(current.theme, prefersDark) === 'dark';
			return {
				userBubble: current.userBubble || (dark ? DEFAULT_USER.dark : DEFAULT_USER.light),
				userText: current.userText || '#ffffff',
				agentBubble: current.agentBubble || (dark ? DEFAULT_FILL.dark : DEFAULT_FILL.light),
				agentText: current.agentText || (dark ? '#e5e5e5' : '#111418')
			};
		},
		set<K extends keyof Prefs>(key: K, value: Prefs[K]) {
			current = normalisePrefs({ ...current, [key]: value });
			persist();
		},
		/**
		 * Set a bubble colour and re-seed its text colour to something readable.
		 * Picking a dark bubble should not silently leave dark text on it; the
		 * text picker is still there for anyone who wants to override.
		 */
		setBubble(who: 'user' | 'agent', background: string) {
			const bubbleKey = who === 'user' ? 'userBubble' : 'agentBubble';
			const textKey = who === 'user' ? 'userText' : 'agentText';
			current = normalisePrefs({
				...current,
				[bubbleKey]: background,
				[textKey]: readableTextOn(background)
			});
			persist();
		},
		reset<K extends keyof Prefs>(...keys: K[]) {
			const patch: Partial<Prefs> = {};
			for (const key of keys) patch[key] = DEFAULTS[key];
			current = normalisePrefs({ ...current, ...patch });
			persist();
		},
		/**
		 * Watch the OS preference so `system` follows it live, and return the
		 * teardown — a media listener that outlives the layout would keep a
		 * destroyed component's state alive.
		 */
		watchSystemTheme(): () => void {
			if (!browser) return () => {};
			const media = window.matchMedia('(prefers-color-scheme: dark)');
			prefersDark = media.matches;
			const onChange = (e: MediaQueryListEvent) => {
				prefersDark = e.matches;
			};
			media.addEventListener('change', onChange);
			return () => media.removeEventListener('change', onChange);
		}
	};
}

export const prefs = createPrefs();
