import { error, json } from '@sveltejs/kit';
import type { PushSubscription } from 'web-push';
import {
	addSubscription,
	publicKey,
	removeSubscription,
	subscriptionCount
} from '$lib/server/push';
import { getManager } from '$lib/server/herdr';
import type { RequestHandler } from './$types';

/** GET: the VAPID public key the browser needs to subscribe. */
export const GET: RequestHandler = async () => {
	const key = publicKey();
	if (!key) throw error(503, 'push is not configured on the server: add VAPID keys to .env');
	// Never let this depend on herdr: with herdr down, getManager() threw and
	// the bell reported a TypeError instead of subscribing.
	const manager = await getManager().catch(() => null);
	return json({
		key,
		subscriptions: subscriptionCount(),
		tracking: manager?.tracked ?? [],
		streamLive: manager?.live ?? false
	});
};

/** POST: store a subscription. DELETE: remove one by endpoint. */
export const POST: RequestHandler = async ({ request }) => {
	const sub = (await request.json()) as PushSubscription;
	if (!sub?.endpoint?.startsWith('https://')) throw error(400, 'not a push subscription');
	addSubscription(sub);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const { endpoint } = (await request.json()) as { endpoint?: string };
	if (!endpoint) throw error(400, 'endpoint is required');
	removeSubscription(endpoint);
	return json({ ok: true });
};
