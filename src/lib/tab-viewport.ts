import type { SplitNode } from './types';

export interface TabViewportOptions {
	tabId: string;
	mono: number;
	density: 'compact' | 'comfortable';
	/** A disabled action keeps its browser owner but holds no Herdr lease. */
	enabled?: boolean;
	/** Mobile projects this pane's usable phone grid back through the tab split. */
	mobile?: boolean;
	paneId?: string;
	tree?: SplitNode;
	onactive?: (active: boolean) => void;
}

export interface TabViewportGeometry {
	cols: number;
	rows: number;
	cellWidthPx: number;
	cellHeightPx: number;
}

const RENEW_MS = 5_000;
/** The TTL the geometry route asks Herdr for: an unrenewed lease is gone after it. */
const LEASE_TTL_MS = 15_000;
const RETRY_CONFLICT_MS = 16_000;
/** A claim that failed for any other reason than a conflict or a 501 waits this long. */
const RETRY_FAILURE_MS = 30_000;
const RESIZE_DEBOUNCE_MS = 180;
const MOBILE_SPLIT_CHROME_CELLS = 2;

export function quantiseViewport(
	width: number,
	height: number,
	cellWidth: number,
	cellHeight: number
): TabViewportGeometry | null {
	if (width <= 0 || height <= 0 || cellWidth <= 0 || cellHeight <= 0) return null;
	return {
		cols: Math.min(1000, Math.max(10, Math.floor(width / cellWidth))),
		rows: Math.min(500, Math.max(3, Math.floor(height / cellHeight))),
		cellWidthPx: Math.max(1, Math.round(cellWidth)),
		cellHeightPx: Math.max(1, Math.round(cellHeight))
	};
}

function paneCount(node: SplitNode): number {
	return node.kind === 'pane' ? 1 : paneCount(node.first) + paneCount(node.second);
}

/** The selected pane's outer span after Herdr applies this split tree. */
function activePaneSpan(
	total: number,
	node: SplitNode,
	paneId: string,
	axis: 'cols' | 'rows'
): number | null {
	if (node.kind === 'pane') return node.paneId === paneId ? total : null;
	const firstHolds = activePaneSpan(total, node.first, paneId, axis) !== null;
	const child = firstHolds ? node.first : node.second;
	if (!firstHolds && activePaneSpan(total, child, paneId, axis) === null) return null;

	const splitAffectsAxis = axis === 'rows' ? node.vertical : !node.vertical;
	if (!splitAffectsAxis) return activePaneSpan(total, child, paneId, axis);
	const first = Math.round(total * node.ratio);
	const childTotal = firstHolds ? first : Math.max(0, total - first);
	return activePaneSpan(childTotal, child, paneId, axis);
}

function surfaceSpanForPane(
	desired: number,
	node: SplitNode,
	paneId: string,
	axis: 'cols' | 'rows',
	minimum: number,
	maximum: number
): number | null {
	if (activePaneSpan(maximum, node, paneId, axis) === null) return null;
	let low = minimum;
	let high = maximum;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		const span = activePaneSpan(middle, node, paneId, axis) ?? 0;
		if (span >= desired) high = middle;
		else low = middle + 1;
	}
	return low;
}

/**
 * Turn the phone space available to one selected pane into the whole tab grid
 * Herdr must own. Sibling panes keep their canonical ratios instead of being
 * squeezed into the phone's width and stealing cells from the selected pane.
 */
export function projectActivePaneGeometry(
	geometry: TabViewportGeometry,
	tree: SplitNode | undefined,
	paneId: string | undefined
): TabViewportGeometry {
	if (!tree || !paneId || paneCount(tree) === 1) return geometry;
	const desiredCols = geometry.cols + MOBILE_SPLIT_CHROME_CELLS;
	const desiredRows = geometry.rows + MOBILE_SPLIT_CHROME_CELLS;
	const cols = surfaceSpanForPane(desiredCols, tree, paneId, 'cols', 10, 1000);
	const rows = surfaceSpanForPane(desiredRows, tree, paneId, 'rows', 3, 500);
	if (cols === null || rows === null) return geometry;
	return { ...geometry, cols, rows };
}

function sameGeometry(a: TabViewportGeometry | null, b: TabViewportGeometry | null): boolean {
	return (
		!!a &&
		!!b &&
		Object.keys(a).every(
			(key) => a[key as keyof TabViewportGeometry] === b[key as keyof TabViewportGeometry]
		)
	);
}

function contentSize(element: HTMLElement): { width: number; height: number } {
	const style = getComputedStyle(element);
	return {
		width: Math.max(
			0,
			element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
		),
		height: Math.max(
			0,
			element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
		)
	};
}

/**
 * Svelte action which leases Herdr's real PTY grid to one visible Bordr view.
 * Herdr's 15-second timeout is authoritative; page lifecycle releases only make
 * restoration quicker when the browser gives us a chance to send one.
 */
export function tabViewport(node: HTMLElement, initial: TabViewportOptions) {
	let options = initial;
	let leaseId = '';
	/** The tab the lease was granted for. The route finds Herdr's machine from it. */
	let leaseTabId = '';
	/** When Herdr last accepted the lease, so failed renewals can tell it has lapsed. */
	let renewedAt = 0;
	let active = false;
	let stopped = false;
	let destroyed = false;
	let unsupported = false;
	/** A claim is in flight for this generation. A second one would orphan a lease. */
	let claiming = false;
	let sentGeometry: TabViewportGeometry | null = null;
	let generation = 0;
	let stableMobileViewport: { width: number; height: number } | null = null;
	let resizeTimer: ReturnType<typeof setTimeout> | undefined;
	let renewTimer: ReturnType<typeof setInterval> | undefined;
	/** The one pending claim retry, after a conflict or a failure. */
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	const ownerId = `bordr:${crypto.randomUUID()}`;

	function enabled() {
		return options.enabled !== false;
	}

	function setActive(next: boolean) {
		if (next === active) return;
		active = next;
		options.onactive?.(next);
	}

	function clearTimers() {
		if (resizeTimer) clearTimeout(resizeTimer);
		if (renewTimer) clearInterval(renewTimer);
		if (retryTimer) clearTimeout(retryTimer);
		resizeTimer = renewTimer = retryTimer = undefined;
	}

	function cellMetrics() {
		const terminal = node.querySelector<HTMLElement>('.term');
		const style = terminal ? getComputedStyle(terminal) : getComputedStyle(node);
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		const fontFamily = terminal ? style.fontFamily : '"IBM Plex Mono", monospace';
		if (context) context.font = `${options.mono}px ${fontFamily}`;
		return {
			width: context?.measureText('0000000000').width
				? context.measureText('0000000000').width / 10
				: options.mono * 0.6,
			height: options.mono * (options.density === 'compact' ? 1.15 : 1.35)
		};
	}

	function stableMobileHeight(): number {
		const width = document.documentElement.clientWidth || window.innerWidth;
		const height = window.innerHeight;
		if (!stableMobileViewport || Math.abs(stableMobileViewport.width - width) > 2) {
			stableMobileViewport = { width, height };
		} else if (height > stableMobileViewport.height) {
			// Browser chrome may uncover more room. A lower same-width height is the
			// software keyboard and must not resize every PTY while someone types.
			stableMobileViewport.height = height;
		}
		return stableMobileViewport.height;
	}

	function measure(): TabViewportGeometry | null {
		const cell = cellMetrics();
		if (!options.mobile) {
			const surface = node.querySelector<HTMLElement>('[data-viewport-surface]') ?? node;
			return quantiseViewport(surface.clientWidth, surface.clientHeight, cell.width, cell.height);
		}

		const header = node.querySelector<HTMLElement>('[data-viewport-header]');
		const composer = node.querySelector<HTMLElement>('[data-viewport-composer]');
		const terminalBody = node.querySelector<HTMLElement>('[data-viewport-terminal-body]');
		const terminal = terminalBody?.querySelector<HTMLElement>('.term');
		const content = terminal ?? node.querySelector<HTMLElement>('[data-viewport-content]') ?? node;
		const box = contentSize(content);
		const headerHeight = header?.getBoundingClientRect().height ?? 0;
		let usableHeight: number;
		if (terminalBody && terminal) {
			const terminalBox = contentSize(terminal);
			const nonScreenChrome = Math.max(0, terminalBody.clientHeight - terminal.clientHeight);
			usableHeight =
				stableMobileHeight() -
				headerHeight -
				nonScreenChrome -
				(terminal.clientHeight - terminalBox.height);
		} else {
			const composerHeight = composer?.getBoundingClientRect().height ?? 0;
			usableHeight = stableMobileHeight() - headerHeight - composerHeight;
		}
		const pane = quantiseViewport(box.width, usableHeight, cell.width, cell.height);
		return pane ? projectActivePaneGeometry(pane, options.tree, options.paneId) : null;
	}

	async function post(
		tabId: string,
		body: Record<string, unknown>,
		keepalive = false
	): Promise<Response> {
		return fetch('/api/geometry', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ tabId, ...body }),
			keepalive
		});
	}

	function startRenewal() {
		if (renewTimer) clearInterval(renewTimer);
		renewTimer = setInterval(() => void sync(true), RENEW_MS);
	}

	function retryClaim(delay: number) {
		if (retryTimer) clearTimeout(retryTimer);
		retryTimer = setTimeout(() => {
			retryTimer = undefined;
			void sync();
		}, delay);
	}

	/** Forget a lease Herdr no longer honours. There is nothing to release. */
	function dropLease() {
		leaseId = '';
		sentGeometry = null;
		setActive(false);
		if (renewTimer) clearInterval(renewTimer);
		renewTimer = undefined;
	}

	/**
	 * A network error or a 5xx keeps the token: the next beat may get through.
	 * Once Herdr's TTL has passed without one, the lease has lapsed there, so
	 * claim afresh rather than renew a dead token for ever.
	 */
	function renewalFailed() {
		if (!leaseId || Date.now() - renewedAt < LEASE_TTL_MS) return;
		dropLease();
		void sync();
	}

	function stopAfterNativeTakeover() {
		stopped = true;
		leaseId = '';
		sentGeometry = null;
		setActive(false);
		clearTimers();
	}

	async function sync(heartbeat = false) {
		if (destroyed || !enabled() || stopped || unsupported) return;
		if (document.visibilityState === 'hidden') return;
		// Without a lease, a claim in flight or a pending retry owns the next
		// attempt. Detail updates arrive every two seconds while an agent works,
		// and each one used to post its own claim and arm its own retry.
		if (!leaseId && (claiming || retryTimer)) return;
		const next = measure();
		if (!next) return;
		if (!heartbeat && leaseId && sameGeometry(next, sentGeometry)) return;
		const claim = !leaseId;
		const tabId = claim ? options.tabId : leaseTabId;
		const mine = ++generation;
		if (claim) claiming = true;
		try {
			const response = await post(
				tabId,
				claim ? { action: 'claim', ownerId, ...next } : { action: 'update', leaseId, ...next }
			);
			if (!response.ok) {
				if (mine !== generation) return;
				const message = await response.text();
				if (response.status === 501) {
					unsupported = true;
					stopAfterNativeTakeover();
					return;
				}
				if (response.status === 409 && message.includes('viewport_not_owned')) {
					// Direct Herdr focus/input revoked us. Do not steal it back on the next beat.
					stopAfterNativeTakeover();
					return;
				}
				if (claim) {
					// A conflict clears when the other browser's lease does. Anything
					// else may be a Herdr that never answers this method, so wait longer
					// rather than claim again on every resize.
					retryClaim(response.status === 409 ? RETRY_CONFLICT_MS : RETRY_FAILURE_MS);
					return;
				}
				if (response.status === 409 && message.includes('viewport_expired')) {
					// Herdr no longer knows this lease (it lapsed, or Herdr restarted).
					dropLease();
					void sync();
					return;
				}
				if (response.status === 400) {
					// Probably a lease Herdr forgot, but a 400 also covers refusals that
					// leave it held. Hand it back first, or the fresh claim meets our own
					// orphan as a conflict and waits out the retry.
					const token = leaseId;
					const tokenTab = leaseTabId;
					dropLease();
					void releaseLease(token, tokenTab).then(() => sync());
					return;
				}
				renewalFailed();
				return;
			}
			const result = (await response.json()) as { lease_id?: string };
			if (mine !== generation) {
				// Hidden, destroyed or moved to another tab while the claim was in
				// flight. Herdr granted it anyway: hand it back now, not after the TTL.
				if (claim && result.lease_id) void releaseLease(result.lease_id, tabId, true);
				return;
			}
			if (claim) {
				if (!result.lease_id) {
					retryClaim(RETRY_FAILURE_MS);
					return;
				}
				leaseId = result.lease_id;
				leaseTabId = tabId;
				setActive(true);
				startRenewal();
			} else if (result.lease_id) {
				leaseId = result.lease_id;
			}
			// Any 2xx renews, whether or not the update echoes the lease id back;
			// otherwise one failed beat 15 s after the claim dropped a live lease.
			renewedAt = Date.now();
			sentGeometry = next;
		} catch {
			if (mine !== generation) return;
			if (claim) retryClaim(RETRY_FAILURE_MS);
			else renewalFailed();
		} finally {
			if (claim && mine === generation) claiming = false;
		}
	}

	function scheduleSync() {
		if (resizeTimer) clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => void sync(), RESIZE_DEBOUNCE_MS);
	}

	async function releaseLease(token: string, tabId: string, keepalive = false) {
		try {
			await post(tabId, { action: 'release', leaseId: token }, keepalive);
		} catch {
			// Expiry is the guarantee when browser teardown drops this request.
		}
	}

	async function release(keepalive = false) {
		generation++;
		// Any claim still in flight is stale now and releases its own answer.
		claiming = false;
		const token = leaseId;
		leaseId = '';
		sentGeometry = null;
		setActive(false);
		if (!token) return;
		await releaseLease(token, leaseTabId, keepalive);
	}

	const targetSelector =
		'[data-viewport-surface], [data-viewport-header], [data-viewport-composer], [data-viewport-terminal-body], [data-viewport-content]';
	const observer = new ResizeObserver(scheduleSync);
	function observeTargets() {
		observer.observe(node);
		for (const target of node.querySelectorAll<HTMLElement>(targetSelector)) {
			observer.observe(target);
		}
	}
	function containsMeasurementTarget(target: Node): boolean {
		return (
			target instanceof Element &&
			(target.matches(targetSelector) || target.querySelector(targetSelector) !== null)
		);
	}
	observeTargets();
	const mutations = new MutationObserver((records) => {
		if (
			!records.some(
				(record) =>
					[...record.addedNodes].some(containsMeasurementTarget) ||
					[...record.removedNodes].some(containsMeasurementTarget)
			)
		)
			return;
		observeTargets();
		scheduleSync();
	});
	mutations.observe(node, { childList: true, subtree: true });

	const onWindowResize = () => scheduleSync();
	const onOrientation = () => {
		stableMobileViewport = null;
		scheduleSync();
	};
	const onVisibility = () => {
		if (document.visibilityState === 'hidden') {
			clearTimers();
			void release(true);
		} else if (!unsupported && enabled()) {
			stopped = false;
			void sync();
		}
	};
	const onPageHide = () => {
		clearTimers();
		void release(true);
	};
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('resize', onWindowResize);
	window.addEventListener('orientationchange', onOrientation);
	window.addEventListener('pagehide', onPageHide);
	const firstFrame = requestAnimationFrame(() => void sync());

	return {
		update(next: TabViewportOptions) {
			const wasEnabled = enabled();
			const tabChanged = next.tabId !== options.tabId;
			options = next;
			if (!enabled()) {
				clearTimers();
				void release();
				return;
			}
			if (tabChanged) {
				clearTimers();
				void release().then(() => {
					stopped = false;
					if (!unsupported) void sync();
				});
			} else {
				if (!wasEnabled) stopped = false;
				scheduleSync();
			}
		},
		destroy() {
			// A tab change may still be waiting on its release to claim the next tab.
			destroyed = true;
			cancelAnimationFrame(firstFrame);
			clearTimers();
			observer.disconnect();
			mutations.disconnect();
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('resize', onWindowResize);
			window.removeEventListener('orientationchange', onOrientation);
			window.removeEventListener('pagehide', onPageHide);
			void release(true);
		}
	};
}
