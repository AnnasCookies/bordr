import type { AgentSummary, WorkspaceNode } from './types';

/**
 * The last good copy of something, kept on this device.
 *
 * A phone on a bad link opens bordr to an empty sidebar until the first
 * response lands. Drawing what was there last time, then replacing it the
 * moment real data arrives, turns "nothing" into "slightly old". Never used
 * for anything you can act on without the live copy confirming it, and dropped
 * after `MAX_AGE_MS` so it cannot point at panes that went long ago.
 */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PREFIX = 'bordr:last:';

export function remember(key: string, value: unknown): void {
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), value }));
	} catch {
		// Private window, blocked storage, or full: the live copy still works.
	}
}

export function recall<T>(key: string, now = Date.now()): T | null {
	try {
		const raw = localStorage.getItem(PREFIX + key);
		if (!raw) return null;
		const { at, value } = JSON.parse(raw) as { at?: number; value?: T };
		if (
			typeof at !== 'number' ||
			!Number.isFinite(at) ||
			at > now ||
			now - at > MAX_AGE_MS ||
			value === undefined
		)
			return null;
		return value;
	} catch {
		return null;
	}
}

function strings(value: unknown, keys: string[]): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		keys.every((key) => typeof (value as Record<string, unknown>)[key] === 'string')
	);
}

/** Remember navigation metadata, never transcript previews or actionable stale pickers. */
export function cachedAgents(value: unknown): AgentSummary[] | null {
	if (
		!Array.isArray(value) ||
		!value.every(
			(a) =>
				strings(a, [
					'paneId',
					'agent',
					'title',
					'cwd',
					'workspaceId',
					'workspaceLabel',
					'tabId',
					'tabLabel'
				]) &&
				['idle', 'working', 'blocked', 'done', 'unknown'].includes(String(a.status)) &&
				Number.isSafeInteger(a.seq) &&
				Number(a.seq) >= 0 &&
				(a.branch === undefined || typeof a.branch === 'string') &&
				[a.ahead, a.behind].every((n) => n === undefined || Number.isFinite(n))
		)
	)
		return null;
	return value.map((a) => ({
		...a,
		picker: null,
		menu: null,
		preview: undefined,
		statusRows: [],
		statusDiagnostic: undefined
	})) as AgentSummary[];
}

/** Only validated nested workspace shape can reach the sidebar's flatMap/render paths. */
export function cachedPanes(value: unknown): { workspaces: WorkspaceNode[] } | null {
	if (!value || typeof value !== 'object') return null;
	const workspaces = (value as { workspaces?: unknown }).workspaces;
	if (
		!Array.isArray(workspaces) ||
		!workspaces.every(
			(w) =>
				strings(w, ['workspaceId', 'machine', 'label', 'branch']) &&
				[w.number, w.ahead, w.behind].every(Number.isFinite) &&
				typeof w.focused === 'boolean' &&
				(w.worktree === undefined ||
					(strings(w.worktree, ['repoKey', 'repoName']) &&
						typeof w.worktree.linked === 'boolean')) &&
				Array.isArray(w.tabs) &&
				w.tabs.every(
					(t: unknown) =>
						strings(t, ['tabId', 'workspaceId', 'label']) &&
						Number.isFinite(t.number) &&
						typeof t.focused === 'boolean' &&
						Array.isArray(t.panes) &&
						t.panes.every(
							(p: unknown) =>
								strings(p, ['paneId', 'tabId', 'workspaceId', 'agent', 'status', 'title', 'cwd']) &&
								typeof p.hasAgent === 'boolean' &&
								typeof p.focused === 'boolean'
						)
				)
		)
	)
		return null;
	return { workspaces: workspaces as WorkspaceNode[] };
}
