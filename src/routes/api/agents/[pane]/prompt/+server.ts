import { error, json } from '@sveltejs/kit';
import { commandReceipt } from '#lib/server/command-receipt.js';
import { HerdrRequestError, promptAgent, readVisible } from '#lib/server/herdr/index.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
	const { text } = (await request.json()) as { text?: string };
	if (!text?.trim()) throw error(400, 'text is required');

	// Taken before the text reaches herdr, on the clock that stamps the
	// transcript, so the browser can match the echo against it.
	const at = Date.now();
	try {
		await promptAgent(params.pane, text);
		const command = await commandReceipt(text, () => readVisible(params.pane));
		return json({ ok: true, command, at });
	} catch (e) {
		if (e instanceof HerdrRequestError) throw error(409, e.message);
		throw e;
	}
};
