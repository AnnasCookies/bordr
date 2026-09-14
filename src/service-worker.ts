/// <reference lib="webworker" />
import { version } from '$service-worker';
import { actionFor, chosenIndex, MAX_ACTIONS } from '$lib/notify';

declare const self: ServiceWorkerGlobalScope;

/**
 * The build this worker was compiled for.
 *
 * Load-bearing, not decoration: a browser installs a new worker only when the
 * FILE's bytes differ. Nothing else in here changes between builds, so
 * without the version baked in the worker was byte-identical every deploy,
 * `activate` never fired again, and the reload below never ran. Verified: the
 * open page stayed on the old document until this was added.
 */
const BUILD = version;

interface PickerAction {
	index: number;
	label: string;
}

interface PushPayload {
	title?: string;
	body?: string;
	url?: string;
	/** Present on a blocked-agent push, so the notification can answer it. */
	paneId?: string;
	/** The first couple of single-select options, as notification buttons. */
	options?: PickerAction[];
}

interface NotificationData {
	url?: string;
	paneId?: string;
	/** Only on the summary, so a third arrival can count past a collapse. */
	count?: number;
}

/** Android notification icons must be raster — SVG silently fails and the
 *  tray falls back to a letter avatar. */
const ICON = '/patrl-192.png';
const BADGE = '/collie-badge.png';

/** The one notification bordr leaves showing when several agents are waiting. */
const SUMMARY_TAG = 'bordr-summary';

/**
 * A push with no body, or one that is not JSON, still deserves a notification
 * — a thrown handler here shows nothing at all, and Chrome then punishes the
 * origin for a silent push.
 */
function readPayload(data: PushMessageData | null): PushPayload {
	if (!data) return {};
	try {
		const parsed: unknown = data.json();
		return typeof parsed === 'object' && parsed !== null ? (parsed as PushPayload) : {};
	} catch {
		return { body: data.text() };
	}
}

/** Notification buttons are a strip, not a menu: two short ones fit. */
function actionsFor(options: PickerAction[] | undefined): NotificationAction[] {
	return (options ?? []).slice(0, MAX_ACTIONS).map(actionFor);
}

/**
 * Android bundles several same-origin web notifications on its own, and a tap
 * on the bundle header opens the origin in the browser instead of firing
 * `notificationclick` here — the phone lands in a generic tab rather than in
 * bordr. The only part of that we control is how many notifications exist, so
 * bordr never leaves more than one: the second arrival collapses the lot into
 * a single summary whose tap does reach this worker.
 *
 * DECISION: this trades per-agent taps for a group tap that works. Landing on
 * `/` is not a loss, because blocked agents are pinned to the top of it.
 */
async function show(data: PushPayload): Promise<void> {
	await self.registration.showNotification(data.title ?? 'bordr', {
		body: data.body ?? 'An agent needs you.',
		data: { url: data.url ?? '/', paneId: data.paneId } satisfies NotificationData,
		tag: data.url ?? 'bordr', // one notification per agent, not a pile
		actions: actionsFor(data.options),
		// An agent waiting on you is not a thing to miss because you happened
		// to be looking at your phone when it arrived. One carrying answer
		// buttons stays in the tray until it is dealt with, and a repeat for
		// the same pane re-alerts rather than swapping itself in silently.
		requireInteraction: Boolean(data.options?.length),
		renotify: true,
		icon: ICON,
		badge: BADGE
	});

	const showing = await self.registration.getNotifications();
	const summary = showing.find((notification) => notification.tag === SUMMARY_TAG);
	const singles = showing.filter((notification) => notification.tag !== SUMMARY_TAG);
	const previous = (summary?.data as NotificationData | undefined)?.count ?? 0;
	const total = singles.length + previous;
	if (total < 2) return;

	for (const notification of showing) notification.close();
	await self.registration.showNotification('bordr', {
		body: `${total} agents need you.`,
		data: { url: '/', count: total } satisfies NotificationData,
		tag: SUMMARY_TAG,
		// Replacing a tagged notification is silent without this, and a newly
		// blocked agent is exactly the moment to make a sound.
		renotify: true,
		icon: ICON,
		badge: BADGE
	});
}

self.addEventListener('push', (event) => {
	event.waitUntil(show(readPayload(event.data)));
});

const MOBILE = /Android|iPhone|iPad/i.test(self.navigator.userAgent);

/**
 * Whether this origin has ever been seen running as an installed app.
 *
 * `openWindow` is right for an installed phone: Android routes an in-scope URL
 * to the app, where focusing "any open window" instead picked up a lingering
 * browser tab and put the conversation outside the app. It is wrong for
 * someone who never installed it, who gets a fresh tab each time instead of
 * the one they already have open.
 *
 * The worker cannot ask whether the app is installed, so the page tells it
 * once, and the answer is kept in the Cache API because a worker's own
 * variables do not survive being shut down. It can only ever be set: someone
 * who installs and later uninstalls keeps today's behaviour.
 */
const STATE_CACHE = 'bordr-state';
const INSTALLED_KEY = '/__installed';

async function everInstalled(): Promise<boolean> {
	try {
		const cache = await caches.open(STATE_CACHE);
		return (await cache.match(INSTALLED_KEY)) !== undefined;
	} catch {
		return false;
	}
}

self.addEventListener('message', (event) => {
	if ((event.data as { type?: string } | null)?.type !== 'standalone') return;
	event.waitUntil(
		caches
			.open(STATE_CACHE)
			.then((cache) => cache.put(INSTALLED_KEY, new Response('1')))
			.catch(() => undefined)
	);
});

async function openTarget(url: string): Promise<void> {
	if (MOBILE && (await everInstalled())) {
		await self.clients.openWindow(url);
		return;
	}
	const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	const mine = clients.find(
		(client) => 'focus' in client && new URL(client.url).origin === self.location.origin
	);
	if (!mine) {
		await self.clients.openWindow(url);
		return;
	}
	const navigated = await mine.navigate(url).catch(() => null);
	await (navigated ?? mine).focus();
}

/**
 * Answer straight from the notification. The endpoint re-reads the picker off
 * the screen rather than trusting us, so a button tapped after the question
 * has moved on is refused rather than misapplied — which is why a failure
 * here opens the agent instead of being swallowed.
 */
async function answer(paneId: string, index: number, url: string): Promise<void> {
	try {
		const response = await fetch(`/api/agents/${encodeURIComponent(paneId)}/answer`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ index })
		});
		if (response.ok) return;
	} catch {
		// Offline, or the host went away mid-tap.
	}
	await openTarget(url);
}

self.addEventListener('notificationclick', (event) => {
	const data = (event.notification.data ?? {}) as NotificationData;
	const url = data.url ?? '/';
	event.notification.close();

	const chosen = chosenIndex(event.action);
	if (chosen !== null && data.paneId) {
		event.waitUntil(answer(data.paneId, chosen, url));
		return;
	}
	event.waitUntil(openTarget(url));
});

// No fetch caching — bordr is a live tool; stale UI is worse than no cache.
self.addEventListener('install', () => void self.skipWaiting());

/**
 * A new build must reach the pages already open on the old one.
 *
 * `vite build` empties the output, so a hashed chunk the open app has not
 * loaded yet is simply gone, and the next navigation 404s. The attic keeps
 * those chunks alive; this is the other half, telling the app a new build
 * exists at the moment it lands rather than on a poll.
 *
 * Only when the worker CHANGES, which is once per deploy — not on every
 * start, or this would be a reload loop.
 */
self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			await self.clients.claim();
			console.info(`bordr service worker active for build ${BUILD}`);

			// A page being READ is not reloaded out from under whoever is
			// reading it — it gets told, and the layout offers its banner. A
			// backgrounded one is reloaded outright: nobody is looking, and it
			// is the copy most likely to be days old and pointing at assets
			// that no longer exist.
			for (const client of await self.clients.matchAll({ type: 'window' })) {
				if (client.visibilityState === 'visible') {
					client.postMessage({ type: 'bordr:updated', build: BUILD });
				} else if ('navigate' in client) {
					await client.navigate(client.url).catch(() => {});
				}
			}
		})()
	);
});
