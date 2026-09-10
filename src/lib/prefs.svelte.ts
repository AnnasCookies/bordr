import { browser } from '$app/environment';
import { parseHex, readableTextOn } from '$lib/contrast';

export type GroupBy = 'workspace' | 'status' | 'harness' | 'none';
export type SortBy = 'status-title' | 'title' | 'recent';
export type PreviewMode = 'activity' | 'cwd' | 'none';
export type Theme = 'light' | 'dark' | 'system';
export type KeyStripMode = 'always' | 'peek';
export type HarnessAccent = 'edge' | 'tint' | 'off';
export type ToolDetail = 'formatted' | 'json';
export type TreeScope = 'all' | 'agents';
export type AgentOrder = 'priority' | 'workspace';
export type StatusPosition = 'header' | 'bottom';
export type WorkControl = 'inline' | 'header';

export interface Prefs {
	v: number;
	groupBy: GroupBy;
	sort: SortBy;
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
	/** Render a tool call the way a terminal shows it, or as raw JSON. */
	toolDetail: ToolDetail;
	/**
	 * Whether the desktop tree lists every pane or only those with an agent.
	 * Some people work agent-first and do not want their shells in the way.
	 */
	treeScope: TreeScope;
	/** How the sidebar's agent section is ordered: by urgency, or by workspace. */
	agentOrder: AgentOrder;
	/**
	 * How much of the sidebar the workspaces section takes, 0.15 to 0.75.
	 * Dragged by the divider between the two sections.
	 */
	sidebarSplit: number;
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
	sort: 'status-title',
	rollup: true,
	preview: 'activity',
	theme: 'system',
	monoSize: 11,
	keyStrip: 'peek',
	showWork: true,
	harnessAccent: 'edge',
	toolDetail: 'formatted',
	treeScope: 'all',
	agentOrder: 'priority',
	sidebarSplit: 0.4,
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
const SORTS: SortBy[] = ['status-title', 'title', 'recent'];
const PREVIEWS: PreviewMode[] = ['activity', 'cwd', 'none'];
const THEMES: Theme[] = ['light', 'dark', 'system'];
const STRIPS: KeyStripMode[] = ['always', 'peek'];
const ACCENTS: HarnessAccent[] = ['edge', 'tint', 'off'];
const TOOL_DETAILS: ToolDetail[] = ['formatted', 'json'];
const TREE_SCOPES: TreeScope[] = ['all', 'agents'];
const AGENT_ORDERS: AgentOrder[] = ['priority', 'workspace'];
const STATUS_POSITIONS: StatusPosition[] = ['header', 'bottom'];
const WORK_CONTROLS: WorkControl[] = ['inline', 'header'];

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
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
		sort: pick(stored.sort, SORTS, DEFAULTS.sort),
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
		toolDetail: pick(stored.toolDetail, TOOL_DETAILS, DEFAULTS.toolDetail),
		treeScope: pick(stored.treeScope, TREE_SCOPES, DEFAULTS.treeScope),
		agentOrder: pick(stored.agentOrder, AGENT_ORDERS, DEFAULTS.agentOrder),
		// Clamped on read: it comes from storage a person can hand-edit, and a
		// value outside this range collapses one section to nothing.
		sidebarSplit:
			typeof stored.sidebarSplit === 'number' && Number.isFinite(stored.sidebarSplit)
				? Math.min(Math.max(stored.sidebarSplit, 0.15), 0.75)
				: DEFAULTS.sidebarSplit,
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
	/** The grouping chips on `/` appear only once grouping has been touched. */
	let touchedGrouping = $state(false);

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
				userBubble: current.userBubble || (dark ? '#2f4fd0' : '#3558e6'),
				userText: current.userText || '#ffffff',
				agentBubble: current.agentBubble || (dark ? '#262626' : '#eceef1'),
				agentText: current.agentText || (dark ? '#e5e5e5' : '#111418')
			};
		},
		get groupingTouched(): boolean {
			return touchedGrouping;
		},
		set<K extends keyof Prefs>(key: K, value: Prefs[K]) {
			current = normalisePrefs({ ...current, [key]: value });
			if (key === 'groupBy') touchedGrouping = true;
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
