import type { AgentSummary } from '$lib/types';
import { checkCompatibility, getManager, listAgents, unreachableCompatibility } from './herdr';
import { enrichAgents } from './enrich';
import { observeStatus } from './push';
import type { Compatibility } from './herdr/compat';
import { readState } from './state-store';

export interface Projection {
	agents: AgentSummary[];
	read: Record<string, number>;
	compat: Compatibility;
	/** Bumped only when the projection actually differs — clients can skip. */
	revision: number;
}

type Subscriber = (p: Projection) => void;

/** How often to try wiring onto herdr's event stream while it is down. */
const REWIRE_MS = 15_000;

/**
 * One shared read of the world, fanned out to every client.
 *
 * Previously each SSE connection ran its own debounce and its own
 * listAgents(), so two phones plus the push watcher meant three
 * independent agent.list + workspace.list round trips per tick. Now one
 * projector polls, dedupes, and pushes to all subscribers.
 *
 * Deduping matters as much as sharing: an idle estate produces byte-identical
 * projections, and those never reach the wire at all.
 */
class Projector {
	private subscribers = new Set<Subscriber>();
	private current: Projection | undefined;
	private revision = 0;
	private serialised = '';
	private unsubscribeEvents: (() => void) | undefined;
	private wiring: Promise<void> | undefined;
	private rewire: ReturnType<typeof setInterval> | undefined;
	private pending: ReturnType<typeof setTimeout> | undefined;
	private firstHeld = 0;
	private refreshing = false;
	private dirty = false;

	/** Coalesce bursts, but never starve: pane_updated fires per output line. */
	private readonly QUIET = 120;
	private readonly MAX_WAIT = 600;
	/**
	 * herdr's events cover state changes and scrollback growth, not the
	 * screen: a dialog drawn in place on an idle pane (pi's /model), or a
	 * question codex asks mid-turn, arrives with no event at all (measured
	 * 2026-09-07). While anyone is watching, the projection is re-read on a
	 * timer as well, so those reach the list within a few seconds.
	 */
	private readonly TICK_MS = 3_000;
	private tick: ReturnType<typeof setInterval> | undefined;

	async subscribe(fn: Subscriber): Promise<Projection> {
		this.subscribers.add(fn);
		this.startTick();
		await this.ensureWired();
		if (!this.current) await this.refresh();
		return this.current as Projection;
	}

	unsubscribe(fn: Subscriber): void {
		this.subscribers.delete(fn);
		if (this.subscribers.size === 0) this.stopTick();
	}

	private startTick(): void {
		if (this.tick) return;
		this.tick = setInterval(() => void this.refresh(), this.TICK_MS);
		// An open phone must never hold the process open.
		(this.tick as unknown as { unref?: () => void }).unref?.();
	}

	private stopTick(): void {
		if (this.tick) clearInterval(this.tick);
		this.tick = undefined;
	}

	/**
	 * Memoised on the in-flight promise: two SSE connections opening at boot
	 * would otherwise both register a listener and every event would refresh
	 * twice. A failure arms the retry timer — a subscriber whose first attempt
	 * found herdr down stays in the set, and this is what eventually feeds it.
	 */
	private ensureWired(): Promise<void> {
		if (this.unsubscribeEvents) return Promise.resolve();
		if (!this.wiring) {
			this.wiring = this.wire()
				.then(() => this.stopRewire())
				.catch((e: unknown) => {
					this.startRewire();
					throw e;
				})
				.finally(() => {
					this.wiring = undefined;
				});
		}
		return this.wiring;
	}

	private async wire(): Promise<void> {
		const manager = await getManager();
		this.unsubscribeEvents = manager.onEvent((e) => {
			if (!REFRESH_ON.has(e.event)) return;
			const now = performance.now();
			if (!this.firstHeld) this.firstHeld = now;
			if (now - this.firstHeld >= this.MAX_WAIT) {
				this.flush();
				return;
			}
			clearTimeout(this.pending);
			this.pending = setTimeout(() => this.flush(), this.QUIET);
		});
	}

	/**
	 * One timer, never stacked: ensureWired() is memoised, so a tick that
	 * overlaps an attempt still in flight joins it rather than starting another.
	 * unref'd so a herdr that never comes back cannot hold the process open.
	 */
	private startRewire(): void {
		if (this.rewire) return;
		this.rewire = setInterval(() => {
			if (this.subscribers.size === 0) {
				// Nobody is waiting; the next subscribe() re-arms this if needed.
				this.stopRewire();
				return;
			}
			this.ensureWired()
				.then(() => this.refresh())
				.catch(() => {
					// herdr still down — the next tick tries again
				});
		}, REWIRE_MS);
		(this.rewire as unknown as { unref?: () => void }).unref?.();
	}

	private stopRewire(): void {
		if (this.rewire) clearInterval(this.rewire);
		this.rewire = undefined;
	}

	private flush(): void {
		clearTimeout(this.pending);
		this.pending = undefined;
		this.firstHeld = 0;
		void this.refresh();
	}

	/**
	 * An event landing mid-refresh marks the projection dirty rather than being
	 * dropped, and one more pass follows — otherwise the change it announced
	 * would not be seen until the next event, which for a pane that just went
	 * quiet may be never. The follow-up goes through the quiet timer rather
	 * than running back to back: a streaming pane fires events faster than a
	 * pass completes, and an immediate loop was a pass for every event.
	 */
	private async refresh(): Promise<void> {
		if (this.refreshing) {
			this.dirty = true;
			return;
		}
		this.refreshing = true;
		try {
			this.dirty = false;
			await this.refreshOnce();
		} finally {
			this.refreshing = false;
		}
		if (this.dirty && !this.pending) {
			this.pending = setTimeout(() => this.flush(), this.QUIET);
		}
	}

	private async refreshOnce(): Promise<void> {
		try {
			const [listed, compat] = await Promise.all([listAgents(), checkCompatibility()]);
			// Preview and blocked-pane pickers, so the list can show what each
			// agent is doing and answer without opening it.
			const agents = await enrichAgents(listed);
			// The enriched status, not herdr's: a dialog on screen counts as
			// blocked for notifications exactly as it does for the list.
			for (const agent of agents) observeStatus(agent.paneId, agent.status);
			this.publish({ agents, read: readState(), compat, revision: this.revision });
		} catch (e) {
			// herdr unreachable after boot. The last agent list is kept, but with
			// compat flipped so a phone shows the banner instead of stale agents
			// as live; the next successful pass restores it.
			this.publish({
				agents: this.current?.agents ?? [],
				read: readState(),
				compat: unreachableCompatibility(e),
				revision: this.revision
			});
		}
	}

	/** Fan out, unless byte-identical to what every subscriber already has. */
	private publish(next: Projection): void {
		// Compared WITHOUT the revision: it is assigned below, so including it
		// made every candidate differ from the last by exactly one number and
		// the dedupe never fired once.
		const serialised = JSON.stringify({
			agents: next.agents,
			read: next.read,
			compat: next.compat
		});
		if (serialised === this.serialised && this.current) return;
		this.serialised = serialised;
		next.revision = ++this.revision;
		this.current = next;
		for (const fn of this.subscribers) fn(next);
	}

	/** Local state changed (a read marker) — re-project without waiting. */
	poke(): void {
		void this.refresh();
	}
}

/**
 * herdr emits global events underscored (pane_updated) and pane-scoped ones
 * dotted (pane.agent_status_changed) — probed live. Match both spellings; a
 * mismatch here fails silently.
 */
const REFRESH_ON = new Set([
	'pane.created',
	'pane.closed',
	'pane.exited',
	'pane.updated',
	'pane.agent_detected',
	'pane.agent_status_changed',
	'pane_created',
	'pane_closed',
	'pane_exited',
	'pane_updated',
	'pane_agent_detected',
	'pane_agent_status_changed'
]);

export const projector = new Projector();
