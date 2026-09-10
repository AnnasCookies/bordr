import { clientFor } from './index';
import { formatPane } from './address';
import type { SplitNode, TabLayout } from '$lib/types';

/**
 * A tab's real split, as herdr has it.
 *
 * herdr does not just tell bordr which panes are in a tab — `session.snapshot`
 * carries a `layouts` entry per tab with every pane's rect in terminal cells,
 * the splits that produced them, and each split's direction and ratio. So the
 * desktop can show the actual arrangement rather than a strip of chips, and a
 * dragged divider is a real `layout.set_split_ratio` rather than a local
 * illusion that the terminal knows nothing about.
 */
interface RawRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface RawSplit {
	id: string;
	direction: string;
	ratio: number;
	rect: RawRect;
}

export interface RawLayout {
	tab_id: string;
	zoomed: boolean;
	area: RawRect;
	focused_pane_id: string;
	panes: { pane_id: string; focused: boolean; rect: RawRect }[];
	splits: RawSplit[];
}

/** Does `inner` sit inside `outer`? Cell rects, so an exact edge counts. */
function within(inner: RawRect, outer: RawRect): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

/** Is this split laid out top-and-bottom rather than side by side? */
function stacked(split: RawSplit): boolean {
	return split.direction === 'down' || split.direction === 'up';
}

/** The smallest rect containing all of them, or null if there are none. */
function bounds(rects: RawRect[]): RawRect | null {
	if (rects.length === 0) return null;
	const x = Math.min(...rects.map((r) => r.x));
	const y = Math.min(...rects.map((r) => r.y));
	const right = Math.max(...rects.map((r) => r.x + r.width));
	const bottom = Math.max(...rects.map((r) => r.y + r.height));
	return { x, y, width: right - x, height: bottom - y };
}

/**
 * The two regions a split divides its rect into.
 *
 * The cut from `ratio` only decides which SIDE each pane falls on; the region
 * is then the bounding box of the panes that landed there. Taking the rounded
 * cut as the region directly would be a cell out whenever herdr rounded the
 * other way, and a region a cell out matches no nested split — which silently
 * collapses that whole branch to one pane rather than failing.
 */
function halves(split: RawSplit, panes: RawLayout['panes']): [RawRect | null, RawRect | null] {
	const { x, y, width, height } = split.rect;
	const down = stacked(split);
	const cut = down ? y + height * split.ratio : x + width * split.ratio;
	const mine = panes.filter((p) => within(p.rect, split.rect)).map((p) => p.rect);
	// Compared at each pane's own midpoint, which never lands on the cut line.
	const first = mine.filter((r) => (down ? r.y + r.height / 2 : r.x + r.width / 2) < cut);
	const second = mine.filter((r) => !first.includes(r));
	return [bounds(first), bounds(second)];
}

/**
 * Rebuild the binary tree from the flat splits and panes.
 *
 * The tree is what `layout.set_split_ratio` needs: its `path` is a list of
 * booleans, one per level, saying which half to descend into. herdr's split
 * ids look like they encode that (`split_0_root`, `split_1_0`) but geometry
 * says it outright — every child rect is contained by its parent's half — so
 * the path is derived rather than parsed out of a name that is free to change.
 */
function build(
	rect: RawRect,
	splits: RawSplit[],
	panes: RawLayout['panes'],
	machineId: string,
	path: boolean[]
): SplitNode {
	const here = splits.find(
		(s) =>
			s.rect.x === rect.x &&
			s.rect.y === rect.y &&
			s.rect.width === rect.width &&
			s.rect.height === rect.height
	);
	const leaf = (): SplitNode => {
		const pane = panes.find((p) => within(p.rect, rect)) ?? panes[0];
		return { kind: 'pane', paneId: formatPane(machineId, pane?.pane_id ?? '') };
	};
	if (!here) return leaf();

	const [first, second] = halves(here, panes);
	// A split with a side holding no pane is not a split any more. herdr should
	// never report one; treating it as a leaf keeps a malformed layout showing
	// the panes it does have rather than rendering nothing.
	if (!first || !second) return leaf();

	const rest = splits.filter((s) => s !== here);
	return {
		kind: 'split',
		vertical: stacked(here),
		ratio: here.ratio,
		path,
		first: build(first, rest, panes, machineId, [...path, false]),
		second: build(second, rest, panes, machineId, [...path, true])
	};
}

/** One tab's layout, as bordr models it. Exported for the geometry tests. */
export function treeFrom(raw: RawLayout, machineId: string): TabLayout {
	return {
		zoomed: raw.zoomed === true,
		focusedPaneId: formatPane(machineId, raw.focused_pane_id ?? ''),
		tree: build(raw.area, raw.splits ?? [], raw.panes, machineId, [])
	};
}

/** Every tab's layout on one machine, keyed by bordr's tab address. */
export async function layoutsFor(machineId: string): Promise<Map<string, TabLayout>> {
	const herdr = await clientFor(machineId);
	const snapshot = await herdr.request<{ snapshot?: { layouts?: RawLayout[] } }>(
		'session.snapshot'
	);
	const out = new Map<string, TabLayout>();

	for (const raw of snapshot.snapshot?.layouts ?? []) {
		if (!raw.panes?.length) continue;
		out.set(formatPane(machineId, raw.tab_id), treeFrom(raw, machineId));
	}
	return out;
}
