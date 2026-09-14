/**
 * The order a sideways swipe walks.
 *
 * Tabs used to REPLACE the agent order rather than sit inside it: a pane in a
 * tab with siblings could be swiped between those siblings and nowhere else,
 * so the rest of the fleet was unreachable by the gesture for as long as you
 * stayed in that tab. The tab was not a step on the way through the list, it
 * was a cul-de-sac.
 *
 * One sequence instead. The agent list is the spine, and the current tab's
 * panes sit together at the place the tab occupies in it — so a swipe walks
 * the tab, reaches its end, and carries on into the next agent.
 *
 * A tab can hold panes the agent list does not: a plain shell is a pane and
 * is not an agent. Those come along, because from inside the tab they are
 * plainly next to you, and a gesture that skips the pane beside the one you
 * are looking at is a gesture that has lied.
 */

/** Only the shape this reads, so a test can build a tree without the rest. */
interface TabShape {
	panes: readonly { paneId: string }[];
}

/**
 * Every pane in the tab that holds `current`, in tab order — the `siblings`
 * both `swipeSequence` and `afterClose` expect.
 *
 * Not one pane per tab. The tab bar used to report its own link targets
 * (one pane for each tab in the workspace) under this name, so closing a
 * split tab from its first pane "fell back" to the second pane of the tab
 * that had just been closed, and the swipe wove other tabs' panes in as if
 * they shared this one.
 *
 * Ids are compared whole: they may carry a machine prefix, and nothing
 * here has any business taking one apart.
 */
export function currentTabPanes(
	workspaces: readonly { tabs: readonly TabShape[] }[],
	current: string
): string[] {
	for (const workspace of workspaces) {
		const tab = workspace.tabs.find((t) => t.panes.some((p) => p.paneId === current));
		if (tab) return tab.panes.map((p) => p.paneId);
	}
	return [];
}

export function swipeSequence(
	/** Every agent, in list order. */
	order: readonly string[],
	/** The panes of the current tab, in tab order. */
	siblings: readonly string[],
	current: string
): string[] {
	// Nothing to weave in: one pane in the tab, or a tab this pane is not in.
	if (siblings.length < 2 || !siblings.includes(current)) return [...order];

	const inTab = new Set(siblings);
	// Where the tab belongs in the list: the first place any of its panes
	// appears. A tab whose panes are all shells appears nowhere, so it goes in
	// at the front rather than being dropped.
	const at = order.findIndex((paneId) => inTab.has(paneId));
	const rest = order.filter((paneId) => !inTab.has(paneId));
	const cut = at === -1 ? 0 : order.slice(0, at).filter((paneId) => !inTab.has(paneId)).length;
	return [...rest.slice(0, cut), ...siblings, ...rest.slice(cut)];
}
