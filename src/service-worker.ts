/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

interface PushPayload {
	title?: string;
	body?: string;
	url?: string;
}

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

self.addEventListener('push', (event) => {
	const data = readPayload(event.data);
	event.waitUntil(
		self.registration.showNotification(data.title ?? 'bordr', {
			body: data.body ?? 'An agent needs you.',
			data: { url: data.url ?? '/' },
			tag: data.url ?? 'bordr', // one notification per agent, not a pile
			// Android notification icons must be raster — SVG silently fails
			// and the tray falls back to a letter avatar.
			icon: '/patrl-192.png',
			badge: '/collie-badge.png'
		})
	);
});

/**
 * On a phone, always ask the OS to open the URL. Android routes an in-scope
 * URL to the installed app; focusing "any open window" instead picked up a
 * lingering browser tab of bordr and put the conversation there, outside the
 * app. On a desktop there is no installed-app distinction worth making, and
 * reusing the open tab is the kinder behaviour.
 */
const MOBILE = /Android|iPhone|iPad/i.test(self.navigator.userAgent);

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = (event.notification.data as { url?: string })?.url ?? '/';
	const open = () => self.clients.openWindow(url);
	if (MOBILE) {
		event.waitUntil(open());
		return;
	}
	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			const mine = clients.find(
				(client) => 'focus' in client && new URL(client.url).origin === self.location.origin
			);
			if (!mine) return open();
			return mine.navigate(url).then((navigated) => (navigated ?? mine).focus());
		})
	);
});

// No fetch caching — bordr is a live tool; stale UI is worse than no cache.
self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
