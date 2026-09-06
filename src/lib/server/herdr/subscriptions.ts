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
		await this.reopen(paneIds);
		this.startHeartbeat();
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
		const unchanged =
			this.live && paneIds.length === this.panes.size && paneIds.every((id) => this.panes.has(id));
		if (!unchanged) await this.reopen(paneIds);
	}

	stop(): void {
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
		let panes: string[] | undefined;
		try {
			panes = this.livePanes ? await this.livePanes() : [...this.panes];
		} catch {
			panes = undefined; // herdr unreachable
		}
		if (panes) {
			try {
				await this.sync(panes);
				return;
			} catch {
				// a pane vanished mid-flight — fall through to globals-only
			}
		}
		if (!this.live) await this.reopen([]);
	}

	private async reopen(paneIds: string[]): Promise<void> {
		const subscriptions = [
			...GLOBAL_SUBSCRIPTIONS.map((type) => ({ type })),
			...paneIds.map((pane_id) => ({ type: 'pane.agent_status_changed', pane_id }))
		];
		const previous = this.closeStream;
		const close = await this.client.subscribe(
			subscriptions,
			(e) => {
				for (const fn of this.listeners) fn(e);
			},
			() => {
				// Stream died underneath us — mark dead so the next sync reopens.
				this.closeStream = undefined;
			}
		);
		previous?.();
		this.closeStream = close;
		this.panes = new Set(paneIds);
	}
}
