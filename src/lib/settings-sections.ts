/**
 * The settings sections, in the order the page renders them.
 *
 * A plain module rather than a constant exported from the nav component: the
 * page, the nav and the drift test all need it, and only one of those three
 * is a component.
 */
export const SECTIONS = [
	'agents list',
	'appearance',
	'header',
	'workspaces & panes',
	'input',
	'chat bubbles',
	'transcript',
	'notifications',
	'connection',
	'system'
] as const;

/** Sections that are routes of their own rather than panes of `/settings`. */
export const ROUTED: readonly string[] = ['connection', 'system'];

export type SettingsSection = (typeof SECTIONS)[number];
