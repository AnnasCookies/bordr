import { json } from '@sveltejs/kit';
import { sendToAll } from '$lib/server/push';
import type { RequestHandler } from './$types';

/** Fire a test notification to every subscription and report each result. */
export const POST: RequestHandler = async () => {
	// Two-minute TTL: an undelivered test must never replay hours later.
	const results = await sendToAll(
		{
			title: 'bordr test',
			body: 'If you can read this, the push pipeline works.',
			url: '/'
		},
		120
	);
	return json({ results });
};
