export type PushState = 'unknown' | 'off' | 'on' | 'unsupported';

/** Never navigator.serviceWorker.ready — it hangs forever if nothing
 *  registered. Register explicitly and move on. */
async function swRegistration(): Promise<ServiceWorkerRegistration> {
	return (
		(await navigator.serviceWorker.getRegistration()) ??
		(await navigator.serviceWorker.register('/service-worker.js'))
	);
}

export async function checkPush(): Promise<PushState> {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
	try {
		const registration = await swRegistration();
		const sub = await registration.pushManager.getSubscription();
		if (!sub) return 'off';
		// Auto-heal: the browser can hold a subscription the server never saw
		// (e.g. the POST failed at subscribe time). Re-sync every load — the
		// server add is idempotent by endpoint.
		const stored = await fetch('/api/push', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(sub.toJSON())
		});
		return stored.ok ? 'on' : 'off';
	} catch {
		return 'off';
	}
}

/** The Push API wants the VAPID key as bytes; only some browsers accept
 *  the base64url string form. Convert explicitly. */
function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
	const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=');
	const raw = atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
	const bytes = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

const NO_VAPID = 'Push is not configured on the server. Add VAPID keys to .env (README, step 6).';

/**
 * Toggle the subscription, returning the new state and any message worth
 * showing. Returns rather than alerts so the caller can render it inline —
 * `alert()` on a PWA home-screen app is a jarring system modal.
 */
export async function togglePushDetailed(
	current: PushState
): Promise<{ state: PushState; message: string | null }> {
	if (current === 'unsupported') return { state: current, message: null };
	try {
		const registration = await swRegistration();
		const existing = await registration.pushManager.getSubscription();
		if (existing) return { state: 'off', message: await forget(existing) };

		// The key comes before the permission prompt: with no VAPID keys there
		// is nothing to subscribe with, and a granted prompt that then fails
		// leaves the site "allowed" with no notification behind it.
		const keyResponse = await fetch('/api/push');
		if (!keyResponse.ok) {
			return {
				state: 'off',
				message:
					keyResponse.status === 503
						? NO_VAPID
						: `Push failed: bordr returned ${keyResponse.status} for the server key.`
			};
		}
		const keyBody: unknown = await keyResponse.json();
		const key =
			typeof keyBody === 'object' && keyBody !== null && 'key' in keyBody ? keyBody.key : null;
		if (typeof key !== 'string' || key.length === 0) {
			throw new Error('the server sent no VAPID public key');
		}

		const permission = await Notification.requestPermission();
		if (permission !== 'granted') {
			return {
				state: 'off',
				message:
					`Notification permission is "${permission}" for this site. ` +
					"Enable it in your browser's site settings, or Settings → Notifications on an installed app, " +
					'then tap the bell again. (Incognito always blocks push.)'
			};
		}
		const sub = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: vapidKeyBytes(key)
		});
		const stored = await fetch('/api/push', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(sub.toJSON())
		});
		if (!stored.ok) {
			const body = (await stored.json().catch(() => null)) as { message?: string } | null;
			throw new Error(body?.message ?? `server refused subscription: ${stored.status}`);
		}
		return { state: 'on', message: null };
	} catch (e) {
		return { state: 'off', message: `Notifications failed: ${(e as Error).message}` };
	}
}

/**
 * Drop the subscription on this device whatever the server says. The
 * browser's copy is what the bell reads at the next load, so failing to
 * unsubscribe locally meant "off" quietly reverted to "on"; the server's
 * stale endpoint expires on its own once a push to it fails.
 */
async function forget(existing: PushSubscription): Promise<string | null> {
	let serverFailure: string | null = null;
	try {
		const removed = await fetch('/api/push', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ endpoint: existing.endpoint })
		});
		if (!removed.ok) serverFailure = `bordr returned ${removed.status}`;
	} catch (e) {
		serverFailure = (e as Error).message;
	}
	await existing.unsubscribe();
	return serverFailure
		? `Notifications are off on this device, but the server did not confirm (${serverFailure}). It will stop on its own once a push to this device fails.`
		: null;
}
