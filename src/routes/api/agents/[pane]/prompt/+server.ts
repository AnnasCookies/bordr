import { error, json } from '@sveltejs/kit';
import { commandReceipt } from '$lib/server/command-receipt';
import { HerdrRequestError, promptAgent, readVisible } from '$lib/server/herdr';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const { text } = (await request.json()) as { text?: string };
	if (!text?.trim()) throw error(400, 'text is required');

	try {
		await promptAgent(params.pane, text);
		const command = await commandReceipt(text, () => readVisible(params.pane));
		return json({ ok: true, command });
	} catch (e) {
		if (e instanceof HerdrRequestError) throw error(409, e.message);
		throw e;
	}
};
