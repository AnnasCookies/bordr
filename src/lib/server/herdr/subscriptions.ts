import type { HerdrClient } from './client';
import type { HerdrEvent } from './protocol';

/**
 * Every subscription that does NOT require a pane_id. Verified against
 * herdr protocol 20 — pane.agent_status_changed, pane.output_matched and
 * pane.scroll_changed are pane-scoped and deliberately absent here.
 */
export const GLOBAL_SUBSCRIPTIONS = [
	'pane.created',
	'pane.closed',
	'pane.exited',
	'pane.updated',
	'pane.agent_detected',
	'pane.focused',
	'layout.updated'
] as const;

/**
 * herdr answers one request per connection, so subscriptions cannot be added
 * to a live stream. The manager holds ONE event-stream connection carrying
 * the full subscription set, and re-opens it (make-before-break) whenever
 * the set of agent panes changes.
 */
export class SubscriptionManager {
	private panes = new Set<string>();
	private closeStream: (() => void) | undefined;
	private listeners = new Set<(e: HerdrEvent) => void>();
	private heartbeat: ReturnType<typeof setInterval> | undefined;
	private reviving = false;
	private generation = 0;
	private stopped = false;
	private pendingSync:
		{ generation: number; panes: Set<string>; promise: Promise<void> } | undefined;

	constructor(
		private client: HerdrClient,
		private reviveMs = 15_000,
		/**
		 * Re-derives the live pane set from herdr. The revive path must never
		 * replay a captured set: herdr answers pane_not_found for a pane that
		 * has gone away and fails the whole subscribe, so a replaying loop
		 * can never converge after the pane set changes.
		 */
		private livePanes?: () => Promise<string[]>
	) {}

	get tracked(): string[] {
		return [...this.panes];
	}

	get live(): boolean {
		return this.closeStream !== undefined;
	}

	onEvent(fn: (e: HerdrEvent) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	async start(paneIds: string[]): Promise<void> {
		this.stopped = false;
		await this.reopen(paneIds);
		if (!this.stopped) this.startHeartbeat();
	}

	/**
	 * Independent liveness timer.
	 *
	 * Every other caller of sync() is driven by events that arrive ON the
	 * stream — so if the stream dies (herdr restarted, socket dropped) with
	 * no browser connected, nothing would ever reopen it and push
	 * notifications would be silently dead forever. This timer is the only
	 * recovery path that does not depend on the thing it recovers.
	 */
	private startHeartbeat(): void {
		if (this.heartbeat) return;
		this.heartbeat = setInterval(() => {
			if (this.reviving) return;
			this.reviving = true;
			void this.reconcile()
				.catch(() => {
					// herdr still down — the next tick tries again
				})
				.finally(() => {
					this.reviving = false;
				});
		}, this.reviveMs);
		// Never hold the process open for this alone.
		(this.heartbeat as unknown as { unref?: () => void }).unref?.();
	}

	/** Re-establish the stream only when the pane set actually changed or the stream died. */
	async sync(paneIds: string[]): Promise<void> {
		if (this.stopped) return;
		const unchanged =
			this.live && paneIds.length === this.panes.size && paneIds.every((id) => this.panes.has(id));
		// Even an unchanged snapshot supersedes an older in-flight replacement.
		if (unchanged) {
			++this.generation;
			this.pendingSync = undefined;
			return;
		}
		const pending = this.pendingSync;
		// Repeated snapshots must not keep superseding the same slow handshake.
		if (
			pending?.generation === this.generation &&
			paneIds.length === pending.panes.size &&
			paneIds.every((id) => pending.panes.has(id))
		)
			return pending.promise;
		const promise = this.reopen(paneIds);
		this.pendingSync = { generation: this.generation, panes: new Set(paneIds), promise };
		try {
			await promise;
		} finally {
			if (this.pendingSync?.promise === promise) this.pendingSync = undefined;
		}
	}

	stop(): void {
		this.stopped = true;
		++this.generation;
		this.pendingSync = undefined;
		this.closeStream?.();
		this.closeStream = undefined;
		if (this.heartbeat) clearInterval(this.heartbeat);
		this.heartbeat = undefined;
	}

	/**
	 * Restore liveness against herdr's CURRENT panes. Falling back to a
	 * globals-only stream matters: it is better to be live and miss
	 * pane-scoped events (the next tick restores them) than to stay dead.
	 */
	private async reconcile(): Promise<void> {
		const generation = this.generation;
		let panes: string[] | undefined;
		try {
			panes = this.livePanes ? await this.livePanes() : [...this.panes];
		} catch {
			panes = undefined; // herdr unreachable
		}
		if (this.stopped || generation !== this.generation) return;
		if (panes) {
			const pending = this.sync(panes);
			const attempt = this.generation;
			try {
				await pending;
				return;
			} catch {
				// Rejection crosses more awaits after reopen's guard. Recheck at
				// the fallback boundary so an old failure cannot cancel newer work.
				if (attempt !== this.generation) return;
				// a pane vanished mid-flight — fall through to globals-only
			}
		}
		if (!this.live) await this.reopen([]);
	}

	private async reopen(paneIds: string[]): Promise<void> {
		if (this.stopped) return;
		const generation = ++this.generation;
		const subscriptions = [
			...GLOBAL_SUBSCRIPTIONS.map((type) => ({ type })),
			...paneIds.map((pane_id) => ({ type: 'pane.agent_status_changed', pane_id }))
		];
		let died = false;
		// onClose may run before the awaited handshake's continuation.
		let close: (() => void) | undefined = undefined;
		try {
			close = await this.client.subscribe(
				subscriptions,
				(e) => {
					for (const fn of this.listeners) fn(e);
				},
				() => {
					died = true;
					// A late callback from an old stream cannot mark its replacement dead.
					if (close && this.closeStream === close) this.closeStream = undefined;
				}
			);
		} catch (error) {
			// Only the current attempt may trigger heartbeat fallback; an obsolete
			// failure must not cancel the newer stream (or a pending restart).
			if (generation !== this.generation) return;
			throw error;
		}
		// Overlapping sync/heartbeat calls may finish in either order. Only the
		// latest request owns a stream; stop also invalidates pending handshakes.
		if (generation !== this.generation || died) {
			close();
			return;
		}
		this.closeStream?.();
		this.closeStream = close;
		this.panes = new Set(paneIds);
	}
}
