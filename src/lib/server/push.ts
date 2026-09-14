import { env } from '$env/dynamic/private';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import webpush, { WebPushError, type PushSubscription } from 'web-push';
import { getManager, listAgents, readVisible } from './herdr';
import { enrichAgents } from './enrich';
import { parsePicker, type Picker } from './picker';
import { offerable } from '$lib/notify';
import { isWatched, loadJson, saveJson } from './state-store';

/**
 * Overridable so tests never touch live state: the service's
 * WorkingDirectory is this same checkout, and vitest wiping .data/ silently
 * cancelled every done-watch and could destroy push-subscriptions.json.
 */
const DATA_DIR = process.env.BORDR_DATA_DIR ?? join(process.cwd(), '.data');
const STORE = join(DATA_DIR, 'push-subscriptions.json');

let configured = false;

function ensureConfigured(): boolean {
	if (configured) return true;
	if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;
	webpush.setVapidDetails(
		env.VAPID_SUBJECT || 'https://github.com/AnnasCookies/bordr',
		env.VAPID_PUBLIC_KEY,
		env.VAPID_PRIVATE_KEY
	);
	configured = true;
	return true;
}

export function publicKey(): string | null {
	return env.VAPID_PUBLIC_KEY || null;
}

function load(): PushSubscription[] {
	try {
		return JSON.parse(readFileSync(STORE, 'utf8')) as PushSubscription[];
	} catch {
		return [];
	}
}

function save(subs: PushSubscription[]): void {
	// Endpoint plus keys is everything needed to push to that phone: owner-only.
	mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
	writeFileSync(STORE, JSON.stringify(subs, null, '\t'), { mode: 0o600 });
}

export function addSubscription(sub: PushSubscription): void {
	const subs = load().filter((s) => s.endpoint !== sub.endpoint);
	subs.push(sub);
	save(subs);
}

export function removeSubscription(endpoint: string): void {
	save(load().filter((s) => s.endpoint !== endpoint));
}

export function subscriptionCount(): number {
	return load().length;
}

export async function sendToAll(
	payload: Record<string, unknown>,
	/** Seconds the push service may queue an undelivered notification. Web
	 *  push defaults to weeks — stale agent alerts must die, not replay. */
	ttlSeconds = 900
): Promise<Array<{ endpoint: string; ok: boolean; status?: number; error?: string }>> {
	if (!ensureConfigured()) return [{ endpoint: '-', ok: false, error: 'vapid not configured' }];
	const subs = load();
	const dead: string[] = [];
	const results = await Promise.all(
		subs.map(async (sub) => {
			try {
				await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: ttlSeconds });
				return { endpoint: sub.endpoint.slice(0, 60), ok: true };
			} catch (e) {
				// 404/410 mean the browser dropped the subscription — prune it.
				if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) {
					dead.push(sub.endpoint);
				}
				const status = e instanceof WebPushError ? e.statusCode : undefined;
				console.error('push send failed', status, (e as Error).message);
				return {
					endpoint: sub.endpoint.slice(0, 60),
					ok: false,
					status,
					error: (e as Error).message
				};
			}
		})
	);
	if (dead.length > 0) save(load().filter((s) => !dead.includes(s.endpoint)));
	return results;
}

/**
 * Boot-time watcher: notify every subscribed phone the moment any agent
 * turns blocked. Dedupes per pane so one blocked state = one notification.
 */
const STATUS_FILE = 'last-status.json';

/**
 * Persisted so a restart cannot re-notify for a block the user already saw
 * — mandatory under Restart=always, where a crash loop would otherwise push
 * every few seconds.
 */
const lastStatus = new Map<string, string>(
	Object.entries(loadJson<Record<string, string>>(STATUS_FILE, {}))
);

function rememberStatus(paneId: string, status: string): void {
	lastStatus.set(paneId, status);
	saveJson(STATUS_FILE, Object.fromEntries(lastStatus));
}

/** Guards against double-wiring: the boot catch retries every 30s, and two
 *  listeners means every notification sent twice. */
let wired = false;

/** Pane lifecycle events — global, always on the stream — that mean the
 *  set of agent panes may have changed. */
// Probed live against herdr 0.8.2: GLOBAL events arrive underscored
// (pane_updated) while PANE-SCOPED ones arrive dotted
// (pane.agent_status_changed). Match both — a mismatch here is silent.
const PANE_LIFECYCLE = new Set([
	'pane.created',
	'pane.closed',
	'pane.exited',
	'pane.agent_detected',
	'pane.updated',
	'pane_created',
	'pane_closed',
	'pane_exited',
	'pane_agent_detected',
	'pane_updated'
]);

async function notifyDone(paneId: string): Promise<void> {
	const agents = await listAgents().catch(() => []);
	const agent = agents.find((a) => a.paneId === paneId);
	await sendToAll(
		{
			title: agent?.title || paneId,
			body: `Finished — tap to review.${agent ? `\n${agent.agent} · ${agent.cwd.replace(homedir(), '~')}` : ''}`,
			url: `/a/${paneId}`
		},
		3600
	);
}

async function notifyBlocked(paneId: string): Promise<void> {
	// Give the picker a beat to finish painting, then lift the actual
	// question into the notification body.
	await new Promise((r) => setTimeout(r, 900));
	const agents = await listAgents().catch(() => []);
	const agent = agents.find((a) => a.paneId === paneId);
	let picker: Picker | null = null;
	try {
		picker = parsePicker(await readVisible(paneId));
	} catch {
		// screen unreadable — the generic body still says what matters
	}
	const question = picker?.question ?? null;
	const cwd = agent?.cwd?.replace(homedir(), '~');
	const detail = [agent?.agent, cwd].filter(Boolean).join(' · ');
	await sendToAll({
		title: agent?.title || paneId,
		body: `${question ?? 'Blocked — waiting on you.'}${detail ? `\n${detail}` : ''}`,
		url: `/a/${paneId}`,
		paneId,
		// Buttons on the notification itself, so a one-tap answer never has to
		// open the app. Single-select only: a checkbox picker needs a submit
		// rather than one index, and answering it from a two-button strip would
		// silently pick the wrong thing. `offerable` owns both rules, and is
		// tested — the worker and this both depend on getting them right.
		options: offerable(picker?.options ?? [], picker?.multi ?? false)
	});
}

/**
 * The single place a status is acted on, whether it arrived as an event or
 * was discovered by reconciliation. Whichever path sees it first writes the
 * map, so the two can never double-notify.
 */
export function observeStatus(paneId: string, status: string): void {
	const previous = lastStatus.get(paneId);
	if (previous === status) return;
	rememberStatus(paneId, status);

	if (status === 'done' && isWatched(paneId)) void notifyDone(paneId);
	if (status === 'blocked') void notifyBlocked(paneId);
}

export async function startPushWatcher(): Promise<void> {
	try {
		const manager = await getManager();

		// The watcher owns keeping status subscriptions in step with live
		// panes. It must never depend on a browser holding the SSE stream
		// open — notifications exist precisely for when no browser is
		// looking. Debounced: pane.updated fires per output line.
		let resync: ReturnType<typeof setTimeout> | undefined;
		const scheduleResync = () => {
			clearTimeout(resync);
			resync = setTimeout(() => {
				void listAgents()
					.then((agents) => manager.sync(agents.map((a) => a.paneId)))
					.catch(() => {});
			}, 400);
		};

		if (!wired) {
			wired = true;
			manager.onEvent((e) => {
				if (PANE_LIFECYCLE.has(e.event)) scheduleResync();
				// Observed frame: {event:'pane.agent_status_changed',
				//   data:{agent_status, pane_id, ...}} — flat, no data.type.
				if (e.event !== 'pane.agent_status_changed' && e.event !== 'pane_agent_status_changed')
					return;
				const { pane_id: paneId, agent_status: status } = e.data as {
					pane_id?: string;
					agent_status?: string;
				};
				if (paneId && status) observeStatus(paneId, status);
			});

			// herdr emits status only on TRANSITION and replays nothing on
			// subscribe, so anything that blocked while bordr was restarting
			// or the stream was down would never notify. Poll the truth.
			const reconcile = setInterval(() => {
				// Enriched, so a pi question (herdr: working, screen: dialog)
				// notifies from here even when no phone has the list open.
				void listAgents()
					.then(enrichAgents)
					.then((agents) => {
						for (const a of agents) observeStatus(a.paneId, a.status);
						for (const paneId of [...lastStatus.keys()]) {
							if (!agents.some((a) => a.paneId === paneId)) lastStatus.delete(paneId);
						}
					})
					.catch(() => {});
			}, 15_000);
			(reconcile as unknown as { unref?: () => void }).unref?.();
		}

		// Catch anything that blocked while we were away, once listeners exist.
		const agents = await listAgents()
			.then(enrichAgents)
			.catch(() => []);
		for (const a of agents) observeStatus(a.paneId, a.status);
	} catch {
		// herdr not up yet — try again shortly; bordr must not crash on boot.
		const retry = setTimeout(() => void startPushWatcher(), 30_000);
		(retry as unknown as { unref?: () => void }).unref?.();
	}
}
