export interface TabViewportOptions {
	tabId: string;
	mono: number;
	density: 'compact' | 'comfortable';
	onactive?: (active: boolean) => void;
}

export interface TabViewportGeometry {
	cols: number;
	rows: number;
	cellWidthPx: number;
	cellHeightPx: number;
}

const RENEW_MS = 5_000;
const RETRY_CONFLICT_MS = 16_000;
const RESIZE_DEBOUNCE_MS = 180;

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

function sameGeometry(a: TabViewportGeometry | null, b: TabViewportGeometry | null): boolean {
	return (
		!!a &&
		!!b &&
		Object.keys(a).every(
			(key) => a[key as keyof TabViewportGeometry] === b[key as keyof TabViewportGeometry]
		)
	);
}

/**
 * Svelte action which leases Herdr's real PTY grid to one visible desktop split.
 * Herdr's 15-second timeout is authoritative; page lifecycle releases only make
 * restoration quicker when the browser gives us a chance to send one.
 */
export function tabViewport(node: HTMLElement, initial: TabViewportOptions) {
	let options = initial;
	let leaseId = '';
	let active = false;
	let stopped = false;
	let unsupported = false;
	let sentGeometry: TabViewportGeometry | null = null;
	let generation = 0;
	let resizeTimer: ReturnType<typeof setTimeout> | undefined;
	let renewTimer: ReturnType<typeof setInterval> | undefined;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	const ownerId = `bordr:${crypto.randomUUID()}`;

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

	function measure(): TabViewportGeometry | null {
		const terminal = node.querySelector<HTMLElement>('.term');
		const style = terminal ? getComputedStyle(terminal) : getComputedStyle(node);
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		const fontFamily = terminal ? style.fontFamily : '"IBM Plex Mono", monospace';
		if (context) context.font = `${options.mono}px ${fontFamily}`;
		const cellWidth = context?.measureText('0000000000').width
			? context.measureText('0000000000').width / 10
			: options.mono * 0.6;
		const cellHeight = options.mono * (options.density === 'compact' ? 1.15 : 1.35);
		return quantiseViewport(node.clientWidth, node.clientHeight, cellWidth, cellHeight);
	}

	async function post(body: Record<string, unknown>, keepalive = false): Promise<Response> {
		return fetch('/api/geometry', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ tabId: options.tabId, ...body }),
			keepalive
		});
	}

	function startRenewal() {
		if (renewTimer) clearInterval(renewTimer);
		renewTimer = setInterval(() => void sync(true), RENEW_MS);
	}

	function stopAfterNativeTakeover() {
		stopped = true;
		leaseId = '';
		sentGeometry = null;
		setActive(false);
		clearTimers();
	}

	async function sync(heartbeat = false) {
		if (stopped || unsupported || document.visibilityState === 'hidden') return;
		const next = measure();
		if (!next) return;
		if (!heartbeat && leaseId && sameGeometry(next, sentGeometry)) return;
		const mine = ++generation;
		try {
			const response = await post(
				leaseId ? { action: 'update', leaseId, ...next } : { action: 'claim', ownerId, ...next }
			);
			if (mine !== generation) return;
			if (!response.ok) {
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
				if (response.status === 409 && !leaseId) {
					retryTimer = setTimeout(() => void sync(), RETRY_CONFLICT_MS);
				}
				return;
			}
			const result = (await response.json()) as { lease_id?: string };
			if (mine !== generation || !result.lease_id) return;
			leaseId = result.lease_id;
			sentGeometry = next;
			setActive(true);
			startRenewal();
		} catch {
			// The current token can still be renewed on the next beat. If not, Herdr
			// restores native geometry at the hard lease deadline.
		}
	}

	function scheduleSync() {
		if (resizeTimer) clearTimeout(resizeTimer);
		resizeTimer = setTimeout(() => void sync(), RESIZE_DEBOUNCE_MS);
	}

	async function release(keepalive = false) {
		generation++;
		const token = leaseId;
		leaseId = '';
		sentGeometry = null;
		setActive(false);
		if (!token) return;
		try {
			await post({ action: 'release', leaseId: token }, keepalive);
		} catch {
			// Expiry is the guarantee when browser teardown drops this request.
		}
	}

	const observer = new ResizeObserver(scheduleSync);
	observer.observe(node);
	const onVisibility = () => {
		if (document.visibilityState === 'hidden') {
			clearTimers();
			void release(true);
		} else if (!unsupported) {
			stopped = false;
			void sync();
		}
	};
	const onPageHide = () => {
		clearTimers();
		void release(true);
	};
	document.addEventListener('visibilitychange', onVisibility);
	window.addEventListener('pagehide', onPageHide);
	requestAnimationFrame(() => void sync());

	return {
		update(next: TabViewportOptions) {
			const tabChanged = next.tabId !== options.tabId;
			options = next;
			if (tabChanged) {
				clearTimers();
				void release().then(() => {
					stopped = false;
					if (!unsupported) void sync();
				});
			} else {
				scheduleSync();
			}
		},
		destroy() {
			clearTimers();
			observer.disconnect();
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', onPageHide);
			void release(true);
		}
	};
}
