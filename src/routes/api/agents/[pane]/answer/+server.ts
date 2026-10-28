import { pickerIdentity } from '#lib/picker-shortcut.js';
import { createHash } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { promptAgent, rawAgent, readVisible, sendKeys, sendText } from '#lib/server/herdr/index.js';
import {
	asyncQuestionKey,
	keysForOption,
	parsePicker,
	pendingAsk,
	type Picker
} from '#lib/server/picker.js';
import { adapterFor } from '#lib/server/transcript/index.js';
import { resolveLocalTranscript } from '#lib/server/transcript/resolve.js';
import { parsePane } from '#lib/server/herdr/address.js';
import { ensureConnection, remoteTranscriptTail } from '#lib/server/herdr/connections.js';
import { readTranscriptTail, DEFAULT_TAIL_BYTES } from '#lib/server/transcript/tail.js';
import type { RequestHandler } from './$types';

const MAX_TEXT = 2000;
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/;

/** A transcript question belongs to the same immutable source as every subsequent key. */
async function transcriptAsk(paneId: string, scope: string): Promise<Picker | null> {
	const raw = await rawAgent(paneId, scope);
	if (!raw) return null;
	const harness = String(raw.agent ?? '');
	// OMP's transcript has no live highlight: never guess relative arrows from it.
	if (harness === 'omp') return null;
	const sessionId = (raw.agent_session as { value?: string } | undefined)?.value;
	const { machineId } = parsePane(paneId);
	const adapter = adapterFor(harness, { remote: Boolean(machineId) });
	if (!sessionId || !adapter) return null;
	if (machineId) {
		const connection = await ensureConnection(machineId);
		if (connection && connection.client.sourceScope !== scope)
			throw error(409, 'the pane target changed');
		const transcript = connection
			? await remoteTranscriptTail(connection.machine, harness, sessionId, DEFAULT_TAIL_BYTES)
			: null;
		return transcript === null ? null : pendingAsk(adapter.parse(transcript));
	}
	const path = await resolveLocalTranscript(adapter, paneId, harness, sessionId);
	if (!path) return null;
	return pendingAsk(adapter.parse((await readTranscriptTail(path)).text));
}

/** Opening a collapsed question is navigation, not permission to answer what it reveals. */
async function openAsyncQuestion(paneId: string, scope: string): Promise<Picker | null> {
	const key = asyncQuestionKey(await readVisible(paneId, scope));
	if (!key) return null;
	await sendKeys(paneId, [key], scope);
	for (let attempt = 0; attempt < 3; attempt++) {
		await new Promise((r) => setTimeout(r, 400));
		const opened = parsePicker(await readVisible(paneId, scope));
		if (opened) return opened;
	}
	throw error(409, "codex's question opened but could not be read — answer it in terminal view");
}

/** A unique wrapped prefix is a rendering difference, never a match between two answers. */
function rowFor(picker: Picker, label: string) {
	const exact = picker.options.filter((option) => option.label === label);
	if (exact.length === 1) return exact[0];
	if (exact.length > 1) return undefined;
	const prefixes = picker.options.filter(
		(option) => option.label.length >= 12 && label.startsWith(option.label)
	);
	return prefixes.length === 1 ? prefixes[0] : undefined;
}

function sameOpenedQuestion(original: Picker, opened: Picker): boolean {
	const normal = (value: string | null) => value?.replace(/\s+/g, ' ').trim();
	if (
		!original.question ||
		normal(original.question) !== normal(opened.question) ||
		original.multi !== opened.multi
	)
		return false;
	const matched = original.options.map((option) => rowFor(opened, option.label));
	if (matched.some((row) => row === undefined)) return false;
	const ids = new Set(matched.map((row) => row!.index));
	if (ids.size !== original.options.length) return false;
	// Codex adds its own free-text row when opening; unrelated extra options are not equivalent.
	return opened.options
		.filter((option) => !ids.has(option.index))
		.every((option) => option.writeIn || /^Other \(write an answer\)$/i.test(option.label));
}

function isBlocked(cause: unknown): boolean {
	if (!(cause instanceof Error)) return false;
	return (
		(cause as { code?: unknown }).code === 'agent_blocked' ||
		/requires interactive input/.test(cause.message)
	);
}

export const POST: RequestHandler = async ({ params, request }) => {
	let input: unknown;
	try {
		input = await request.json();
	} catch {
		throw error(400, 'invalid JSON');
	}
	if (!input || typeof input !== 'object' || Array.isArray(input))
		throw error(400, 'an answer object is required');
	const body = input as {
		index?: number;
		submit?: boolean;
		dialog?: unknown;
		dialogHash?: unknown;
		scope?: unknown;
		text?: unknown;
	};
	const { submit, text, dialog, dialogHash } = body;
	if (body.index !== undefined && (!Number.isSafeInteger(body.index) || body.index < 1))
		throw error(400, 'a positive integer index is required');
	if (submit !== undefined && typeof submit !== 'boolean') throw error(400, 'invalid submit');
	if (dialog !== undefined && typeof dialog !== 'string') throw error(400, 'invalid dialog');
	if (
		dialogHash !== undefined &&
		(typeof dialogHash !== 'string' || !/^[a-f0-9]{64}$/.test(dialogHash))
	)
		throw error(400, 'invalid dialog fingerprint');
	if (body.scope !== undefined && typeof body.scope !== 'string')
		throw error(400, 'invalid target scope');
	if (parsePane(params.pane).machineId && typeof body.scope !== 'string')
		throw error(400, 'remote answer scope required');
	const scope = typeof body.scope === 'string' ? body.scope : '';
	const read = () => readVisible(params.pane, scope);
	const send = (keys: string[]) => sendKeys(params.pane, keys, scope);
	const settle = () => new Promise((r) => setTimeout(r, 500));
	let index = body.index;
	if (typeof index !== 'number' && submit !== true) throw error(400, 'index or submit required');

	let picker = parsePicker(await read()) ?? (await transcriptAsk(params.pane, scope));
	if (!picker) throw error(409, 'no picker on screen');
	if (
		(dialog !== undefined && dialog !== pickerIdentity(picker)) ||
		(dialogHash !== undefined &&
			dialogHash !== createHash('sha256').update(pickerIdentity(picker)).digest('hex'))
	)
		throw error(409, 'the question changed before the answer could be sent');
	const sameDialog = (a: Picker, b: Picker) => pickerIdentity(a) === pickerIdentity(b);

	if (picker.answer === 'text') {
		if (typeof index !== 'number') throw error(400, 'index is required');
		const wanted = picker.options.find((option) => option.index === index);
		if (!wanted) throw error(409, `option ${index} is not on screen`);
		const opened = await openAsyncQuestion(params.pane, scope);
		if (opened) {
			if (!sameOpenedQuestion(picker, opened))
				throw error(409, 'the question changed when its dialog was opened');
			const row = rowFor(opened, wanted.label);
			if (!row) throw error(409, 'the question on screen does not offer that answer');
			picker = opened;
			index = row.index;
		}
	}

	if (picker.answer === 'text') {
		const wanted = picker.options.find((option) => option.index === index);
		if (!wanted) throw error(409, `option ${index} is not on screen`);
		try {
			await promptAgent(params.pane, wanted.label, scope);
		} catch (cause) {
			if (!isBlocked(cause)) throw cause;
			throw error(
				409,
				'the agent is waiting on a dialog bordr cannot read — answer it in terminal view'
			);
		}
		let still: Picker | null = picker;
		for (let attempt = 0; attempt < 2 && still; attempt++) {
			await new Promise((r) => setTimeout(r, 1_500));
			still = await transcriptAsk(params.pane, scope);
		}
		return json({ ok: true, chose: wanted.label, outcome: still ? 'unknown' : 'accepted' });
	}

	if (submit === true) {
		if (!picker.multi) throw error(409, 'not a multi-select picker');
		// Enter toggles on checkbox rows; only the unhighlighted Submit row submits.
		let submitted = false;
		for (let attempt = 0; attempt < 4; attempt++) {
			const current = parsePicker(await read());
			if (!current || !sameDialog(picker, current)) {
				if (submitted) return json({ ok: true, chose: 'submit', outcome: 'accepted' });
				throw error(409, 'the question changed before submission');
			}
			if (submitted) {
				await new Promise((r) => setTimeout(r, 800));
				continue;
			}
			const highlighted = current.options.find((option) => option.selected)?.index;
			if (highlighted === undefined) {
				submitted = true;
				await send(['enter']);
			} else {
				const maxBox = Math.max(
					...current.options
						.filter((option) => option.checked !== undefined)
						.map((option) => option.index)
				);
				await send(Array(Math.max(1, maxBox - highlighted + 1)).fill('down'));
			}
			await new Promise((r) => setTimeout(r, 800));
		}
		if (submitted) return json({ ok: true, chose: 'submit', outcome: 'unknown' });
		throw error(409, 'could not reach the Submit row — is a write-in option ticked?');
	}
	if (typeof index !== 'number') throw error(400, 'index is required');
	const wanted = picker.options.find((option) => option.index === index);
	if (!wanted) throw error(409, `option ${index} is not on screen`);

	if (wanted.writeIn) {
		if (typeof text !== 'string' || !text.trim())
			throw error(400, 'type an answer for that option first');
		if (text.length > MAX_TEXT) throw error(400, `at most ${MAX_TEXT} characters`);
		if (CONTROL.test(text)) throw error(400, 'control characters are not allowed');
		const from = picker.options.find((option) => option.selected)?.index;
		if (from === undefined) throw error(409, 'could not tell which row is highlighted');
		const distance = index - from;
		if (distance) await send(Array(Math.abs(distance)).fill(distance > 0 ? 'down' : 'up'));
		await settle();
		await sendText(params.pane, text, scope);
		await settle();
		await send(['enter']);
		await settle();
		let outcome: 'accepted' | 'unknown' = 'unknown';
		try {
			const after = parsePicker(await read());
			if (!after || !sameDialog(picker, after)) outcome = 'accepted';
		} catch {
			// Unreadable verification is not an invitation to resend the answer.
		}
		return json({ ok: true, chose: text, outcome });
	}

	const current = picker.options.find((option) => option.selected)?.index;
	// One confirmation, never a probe followed by Enter into an identical successor.
	await send(keysForOption(index, current, picker.numbered && current === undefined, picker.axis));
	await settle();
	let outcome: 'accepted' | 'unknown' = 'unknown';
	try {
		const after = parsePicker(await read());
		if (!after) outcome = 'accepted';
		else if (
			after.multi &&
			after.options.find((option) => option.index === index)?.checked !== wanted.checked
		)
			outcome = 'accepted';
	} catch {
		// A failed read leaves delivery unconfirmed, not automatically retried.
	}
	return json({ ok: true, chose: wanted.label, outcome });
};
