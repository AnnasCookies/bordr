import { describe, expect, it } from 'vitest';
import { DEFAULTS, normalisePrefs, resolveTheme } from './prefs.svelte';
import { meetsAA } from './contrast';

describe('normalisePrefs', () => {
	it('returns the defaults for nothing stored', () => {
		expect(normalisePrefs(null)).toEqual(DEFAULTS);
		expect(normalisePrefs('nonsense')).toEqual(DEFAULTS);
	});

	it('keeps values it recognises', () => {
		const stored = { ...DEFAULTS, groupBy: 'status', theme: 'dark', enterSends: true };
		expect(normalisePrefs(stored)).toMatchObject({
			groupBy: 'status',
			theme: 'dark',
			enterSends: true
		});
	});

	/**
	 * A bad stored value must not survive: an unreadable mono size or an unknown
	 * grouping would render a UI with no way back to Settings to undo it.
	 */
	it('falls back per field rather than rejecting the whole object', () => {
		const merged = normalisePrefs({ groupBy: 'sideways', theme: 'dark', rollup: 'yes' });
		expect(merged.groupBy).toBe(DEFAULTS.groupBy);
		expect(merged.rollup).toBe(DEFAULTS.rollup);
		expect(merged.theme).toBe('dark');
	});

	it('clamps mono size to the range Settings offers', () => {
		expect(normalisePrefs({ monoSize: 2 }).monoSize).toBe(10);
		expect(normalisePrefs({ monoSize: 99 }).monoSize).toBe(13);
		expect(normalisePrefs({ monoSize: 12.4 }).monoSize).toBe(12);
		expect(normalisePrefs({ monoSize: 'big' }).monoSize).toBe(DEFAULTS.monoSize);
	});

	it('refuses a blank dictation language rather than passing it to the recogniser', () => {
		expect(normalisePrefs({ dictationLang: '   ' }).dictationLang).toBe('en-GB');
		expect(normalisePrefs({ dictationLang: 'fr-FR' }).dictationLang).toBe('fr-FR');
	});

	it('reads prefs written by a future version on the same terms', () => {
		expect(normalisePrefs({ v: 9, groupBy: 'harness' }).groupBy).toBe('harness');
	});

	/**
	 * Chips used to be hidden until grouping was touched, which reset on every
	 * load and read as a bug. Anyone upgrading has no stored value, so the
	 * default is what they get, and it has to be "visible".
	 */
	/**
	 * The phone's back gesture from inside an agent returns to the agents
	 * list, which was asked for explicitly. #30 flipped the default to
	 * 'history' and every pane link began pushing, so back walked through
	 * every pane visited instead. A fresh install, and any install with
	 * nothing stored, must get 'home'.
	 *
	 * 'history' is still there for anyone who wants back to retrace.
	 */
	it('goes straight home on back unless asked to retrace', () => {
		expect(DEFAULTS.backTo).toBe('home');
		expect(normalisePrefs({}).backTo).toBe('home');
		expect(normalisePrefs({ backTo: 'history' }).backTo).toBe('history');
		expect(normalisePrefs({ backTo: 'sideways' }).backTo).toBe('home');
	});

	it('shows the grouping chips unless they were explicitly turned off', () => {
		expect(DEFAULTS.showGrouping).toBe(true);
		expect(normalisePrefs({}).showGrouping).toBe(true);
		expect(normalisePrefs({ showGrouping: false }).showGrouping).toBe(false);
		expect(normalisePrefs({ showGrouping: 'no' }).showGrouping).toBe(true);
	});

	it('splits thinking from tools without losing the old combined choice', () => {
		expect(DEFAULTS.showThinking).toBe(true);
		expect(normalisePrefs({ showWork: false }).showThinking).toBe(false);
		expect(normalisePrefs({ showWork: false, showThinking: true })).toMatchObject({
			showWork: false,
			showThinking: true
		});
	});

	it('accepts Herdr’s agent orders and migrates the old workspace name', () => {
		expect(normalisePrefs({ agentOrder: 'priority' }).agentOrder).toBe('priority');
		expect(normalisePrefs({ agentOrder: 'grouped' }).agentOrder).toBe('grouped');
		expect(normalisePrefs({ agentOrder: 'workspace' }).agentOrder).toBe('grouped');
		expect(normalisePrefs({ agentOrder: 'alphabetical' }).agentOrder).toBe(DEFAULTS.agentOrder);
	});

	it('accepts the collapsible JSON tree tool view', () => {
		expect(normalisePrefs({ toolDetail: 'tree' }).toolDetail).toBe('tree');
		expect(normalisePrefs({ toolDetail: 'xml' }).toolDetail).toBe(DEFAULTS.toolDetail);
	});

	it('drops the old conversation width cap', () => {
		expect(normalisePrefs({ conversationWidth: 'comfortable' })).not.toHaveProperty(
			'conversationWidth'
		);
	});

	it('follows the OS only for system', () => {
		expect(resolveTheme('system', true)).toBe('dark');
		expect(resolveTheme('system', false)).toBe('light');
		expect(resolveTheme('light', true)).toBe('light');
		expect(resolveTheme('dark', false)).toBe('dark');
	});
});

describe('normalisePrefs: bubble colours', () => {
	/** These values reach an inline `style`; anything but a hex colour is refused. */
	it('keeps a real hex colour and rejects everything else', () => {
		expect(normalisePrefs({ userBubble: '#abc' }).userBubble).toBe('#abc');
		expect(normalisePrefs({ userBubble: '#12ff34' }).userBubble).toBe('#12ff34');
		for (const bad of ['red', 'rgb(0,0,0)', 'javascript:alert(1)', '#12', '', 42]) {
			expect(normalisePrefs({ agentBubble: bad }).agentBubble, String(bad)).toBe(
				DEFAULTS.agentBubble
			);
		}
	});

	it('defaults swipe on and bubbles off', () => {
		expect(DEFAULTS.swipeAgents).toBe(true);
		expect(DEFAULTS.bubbles).toBe(false);
		expect(normalisePrefs({ swipeAgents: 'yes' }).swipeAgents).toBe(true);
	});

	it('leaves colours empty by default, meaning follow the theme', () => {
		expect(DEFAULTS.userBubble).toBe('');
		expect(DEFAULTS.agentBubble).toBe('');
		expect(normalisePrefs({ userBubble: '' }).userBubble).toBe('');
	});

	/**
	 * Whatever the theme fills in must be readable, or bubbles would ship
	 * unreadable out of the box for anyone who never opens a picker.
	 */
	it('ships a readable pair in both themes', () => {
		for (const [bubble, text] of [
			['#3558e6', '#ffffff'],
			['#2f4fd0', '#ffffff'],
			['#eceef1', '#111418'],
			['#262626', '#e5e5e5']
		]) {
			expect(meetsAA(bubble, text), `${bubble} on ${text}`).toBe(true);
		}
	});
});
