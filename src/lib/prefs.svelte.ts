import { browser } from '$app/environment';
import { parseHex, readableTextOn } from '$lib/contrast';

export type GroupBy = 'workspace' | 'status' | 'harness' | 'none';
export type SortBy = 'status-title' | 'title' | 'recent';
export type PreviewMode = 'activity' | 'cwd' | 'none';
export type Theme = 'light' | 'dark' | 'system';
export type KeyStripMode = 'always' | 'peek';

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
	/** Tint the agent bubble with the harness's accent when no colour is picked. */
	harnessBubbles: boolean;
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
	harnessBubbles: true,
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
		harnessBubbles: bool(stored.harnessBubbles, DEFAULTS.harnessBubbles),
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
