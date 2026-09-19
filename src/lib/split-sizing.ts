import type { SplitNode } from '$lib/types';

/** Whether a rebuilt Herdr split branch contains the pane being read. */
export function splitContains(node: SplitNode, paneId: string): boolean {
	if (node.kind === 'pane') return node.paneId === paneId;
	return splitContains(node.first, paneId) || splitContains(node.second, paneId);
}

export interface SplitBranchStyles {
	first: string;
	second: string;
	auto: boolean;
}

/**
 * Size the active conversation around the useful content of its sibling pane.
 *
 * Herdr's ratio remains the fallback and takes over after any manual resize.
 * Auto mode gives an inactive terminal a bounded slot so it can neither
 * vanish nor swallow more than 35% of the desktop view. A side preview starts
 * at 14rem, then PaneScreen raises its flex basis to the source grid width.
 */
export function splitBranchStyles(
	vertical: boolean,
	ratio: number,
	firstHasActive: boolean,
	secondHasActive: boolean,
	manual: boolean
): SplitBranchStyles {
	const auto = !manual && firstHasActive !== secondHasActive;
	if (!auto) {
		return {
			first: `flex: ${ratio} 1 0`,
			second: `flex: ${1 - ratio} 1 0`,
			auto: false
		};
	}

	const compact = vertical
		? 'flex: 0 0 clamp(7rem, 18%, 35%); max-height: 35%'
		: 'flex: 0 1 14rem; max-width: 35%';
	const active = 'flex: 1 1 0';
	return {
		first: firstHasActive ? active : compact,
		second: secondHasActive ? active : compact,
		auto: true
	};
}
