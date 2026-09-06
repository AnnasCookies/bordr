import { error, json } from '@sveltejs/kit';
import { HerdrRequestError, promptAgent } from '$lib/server/herdr';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const { text } = (await request.json()) as { text?: string };
	if (!text?.trim()) throw error(400, 'text is required');

	try {
		await promptAgent(params.pane, text);
		return json({ ok: true });
	} catch (e) {
		if (e instanceof HerdrRequestError) throw error(409, e.message);
		throw e;
	}
};
