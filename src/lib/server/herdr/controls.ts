import { clientFor } from './index';
import { parsePane } from './address';

/**
 * herdr's own controls, the ones worth having on a phone.
 *
 * bordr calls 13 of herdr's 111 socket methods, and everything it drives is
 * an AGENT: prompt it, answer it, read it. The workspace itself — the tabs,
 * the panes, their names — was read-only, so the phone could see the shape of
 * a session and change nothing about it.
 *
 * These are the three that earn a place there:
 *
 *   focus   put a pane on the actual terminal, so walking to the desk
 *           continues where the phone left off
 *   rename  name the work, which is the thing that tells two identical rows
 *           apart — and bordr now shows tab names, so it should set them
 *   close   the housekeeping, which is the one that needs asking twice
 *
 * Everything else herdr offers — splits, moves, resizes, worktrees, plugin
 * management — is either fiddly on a phone or rare enough to belong at a
 * keyboard. They are a socket call away if that changes.
 */

/** What a control acts on. Each carries its machine in the address. */
export type Scope = 'pane' | 'tab' | 'workspace';

/** herdr names the id field after the scope. */
const ID_FIELD: Record<Scope, string> = {
	pane: 'pane_id',
	tab: 'tab_id',
	workspace: 'workspace_id'
};

/**
 * Split `<machine>:<id>` and hand back a client for that machine plus the
 * bare id, since herdr on the far end knows nothing about bordr's addressing.
 */
async function target(scope: Scope, address: string) {
	const { machineId, paneId: id } = parsePane(address);
	return { herdr: await clientFor(machineId), params: { [ID_FIELD[scope]]: id } };
}

/** Put it on the terminal's own screen. */
export async function focus(scope: Scope, address: string): Promise<void> {
	const { herdr, params } = await target(scope, address);
	await herdr.request(`${scope}.focus`, params);
}

/**
 * Name it, or clear the name back to herdr's default.
 *
 * A pane and an agent take `null` to mean "forget the name I gave it"; a tab
 * and a workspace take a string and nothing else, so an empty one is refused
 * rather than sent and turned into a tab literally called "".
 */
export async function rename(scope: Scope, address: string, label: string): Promise<void> {
	const trimmed = label.trim();
	const { machineId, paneId: id } = parsePane(address);
	const herdr = await clientFor(machineId);
	if (scope === 'pane') {
		await herdr.request('pane.rename', { pane_id: id, label: trimmed || null });
		return;
	}
	if (!trimmed) throw new Error(`a ${scope} needs a name`);
	await herdr.request(`${scope}.rename`, { [ID_FIELD[scope]]: id, label: trimmed });
}

/**
 * Close it.
 *
 * Kept apart from the rest so that nothing can reach it by passing a string:
 * every other control is recoverable by doing it again, and this one ends
 * whatever was running inside.
 */
export async function close(scope: 'pane' | 'tab', address: string): Promise<void> {
	const { herdr, params } = await target(scope, address);
	await herdr.request(`${scope}.close`, params);
}

/**
 * One checkout of a repository, as herdr reports it.
 *
 * The source checkout is in this list too, marked by `linked: false` — a
 * worktree list that leaves out the repository you are standing in reads as
 * if it had gone missing.
 */
export interface Worktree {
	path: string;
	/** Empty on a detached checkout, which has a commit rather than a branch. */
	branch: string;
	/** A `git worktree` rather than the original clone. */
	linked: boolean;
	detached: boolean;
	/** Its directory is gone; `git worktree prune` would drop it. */
	prunable: boolean;
}

export interface WorktreeList {
	repo: string;
	root: string;
	worktrees: Worktree[];
}

interface RawWorktree {
	path?: unknown;
	branch?: unknown;
	is_linked_worktree?: unknown;
	is_detached?: unknown;
	is_prunable?: unknown;
}

/** Every checkout of the repository this pane is working in. */
export async function listWorktrees(address: string, cwd: string): Promise<WorktreeList> {
	const { machineId } = parsePane(address);
	const herdr = await clientFor(machineId);
	const result = await herdr.request<{
		source?: { repo_name?: unknown; repo_root?: unknown };
		worktrees?: RawWorktree[];
	}>('worktree.list', { cwd });
	return {
		repo: String(result.source?.repo_name ?? ''),
		root: String(result.source?.repo_root ?? ''),
		worktrees: (result.worktrees ?? []).map((w) => ({
			path: String(w.path ?? ''),
			branch: typeof w.branch === 'string' ? w.branch : '',
			linked: w.is_linked_worktree === true,
			detached: w.is_detached === true,
			prunable: w.is_prunable === true
		}))
	};
}

/**
 * Make a worktree and give it a workspace of its own.
 *
 * `focus` is deliberately false. This is started from a phone, and the point
 * is usually to have it waiting rather than to yank the terminal onto it
 * while somebody else is looking at that screen. Focus it afterwards from the
 * same sheet if that is what you meant.
 */
export async function createWorktree(
	address: string,
	cwd: string,
	branch: string,
	base: string
): Promise<void> {
	const { machineId } = parsePane(address);
	const herdr = await clientFor(machineId);
	await herdr.request('worktree.create', {
		cwd,
		branch: branch.trim(),
		base: base.trim() || null,
		focus: false
	});
}

/** Open an existing checkout in a workspace, without making anything. */
export async function openWorktree(address: string, cwd: string, path: string): Promise<void> {
	const { machineId } = parsePane(address);
	const herdr = await clientFor(machineId);
	await herdr.request('worktree.open', { cwd, path, focus: false });
}
