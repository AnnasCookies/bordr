import { error, json } from '@sveltejs/kit';
import { HerdrRequestError, sendText } from '$lib/server/herdr';
import type { RequestHandler } from './$types';

/**
 * A keystroke's worth of text, into the pane's input line.
 *
 * Separate from `prompt`, which submits a whole turn: this one only types, so
 * terminal mode's characters land in the harness's own box and the harness
 * decides what they mean. Control characters are refused — a typing channel
 * must not become a way to send escape sequences.
 */
const MAX = 2000;
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

export const POST: RequestHandler = async ({ params, request }) => {
	const { text } = (await request.json()) as { text?: unknown };
	if (typeof text !== 'string' || text.length === 0) throw error(400, 'text is required');
	if (text.length > MAX) throw error(400, `at most ${MAX} characters per send`);
	if (CONTROL.test(text)) throw error(400, 'control characters are not allowed');

	try {
		await sendText(params.pane, text);
		return json({ ok: true });
	} catch (e) {
		if (e instanceof HerdrRequestError) throw error(409, e.message);
		if (e instanceof Error) throw error(503, `herdr is not reachable: ${e.message}`);
		throw e;
	}
};
