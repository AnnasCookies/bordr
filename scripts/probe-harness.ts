#!/usr/bin/env bun
/**
 * Put one harness through the sequence Claude Code passes, via bordr's own
 * API and herdr's socket, and print a JSON report of what bordr showed at
 * each step. Costs one short agent turn on that harness.
 *
 * Usage: bun run scripts/probe-harness.ts <kind> [url] [cwd]
 */
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Map(
	process.argv
		.slice(2)
		.filter((a) => a.startsWith('--'))
		.map((a) => a.slice(2).split('=') as [string, string])
);
const kind = args[0];
const url = args[1] ?? 'http://127.0.0.1:7682';
const cwd = args[2] ?? join(homedir(), '.cache', 'bordr-harness-probe');
/** --pane=<id>: drive an existing pane instead of creating one (and leave it open). */
const existingPane = flags.get('pane');
if (!kind) throw new Error('usage: probe-harness.ts <kind> [url] [cwd] [--pane=<id>]');

const SOCKET =
	process.env.HERDR_SOCKET ?? join(homedir(), '.config/herdr/sessions/main/herdr.sock');
const HEADERS = {
	'content-type': 'application/json',
	'sec-fetch-site': 'same-origin',
	origin: url
};

const PROMPT =
	'Reply with the single line PROBE OK. Then list the files in the current directory using a tool. ' +
	"Then, if you have a tool for asking the user a question with options, ask me 'Which colour?' with " +
	'options Red, Green, Blue and wait for my answer. If you have no such tool, reply with the single line NO ASK TOOL.';
const START_PROMPT = '-- Reply with the single line STARTED OK.';

interface Detail {
	status: string;
	degraded: string;
	degradedMessage: string | null;
	messages: Array<{ role: string; text: string; tools: Array<{ name: string; summary: string }> }>;
	picker: { question: string | null; options: Array<{ index: number; label: string }> } | null;
	menu: string | null;
	statusLines: string[];
	screenTail: string;
}
interface Row {
	paneId: string;
	status: string;
	preview?: string;
	picker: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const herdr = (method: string, params: Record<string, unknown>) =>
	new Promise<Record<string, unknown>>((resolve, reject) => {
		const socket = connect(SOCKET);
		let buffer = '';
		socket.on('connect', () => socket.write(JSON.stringify({ id: '1', method, params }) + '\n'));
		socket.on('data', (chunk) => {
			buffer += chunk.toString();
			const nl = buffer.indexOf('\n');
			if (nl < 0) return;
			resolve(JSON.parse(buffer.slice(0, nl)) as Record<string, unknown>);
			socket.destroy();
		});
		socket.on('error', reject);
		setTimeout(() => reject(new Error(`herdr ${method} timed out`)), 10_000).unref();
	});

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
	const response = await fetch(`${url}${path}`, {
		...init,
		headers: { ...HEADERS, ...(init?.headers ?? {}) }
	});
	const text = await response.text();
	let body: T;
	try {
		body = JSON.parse(text) as T;
	} catch {
		body = text as unknown as T;
	}
	return { status: response.status, body };
}
const row = async (paneId: string) =>
	(await api<{ agents: Row[] }>('/api/agents')).body.agents.find((a) => a.paneId === paneId);
const detail = async (paneId: string) => (await api<Detail>(`/api/agents/${paneId}`)).body;

const report: Record<string, unknown> = { kind, started: new Date().toISOString() };
const timeline: string[] = [];
const note = (s: string) => timeline.push(`${new Date().toISOString().slice(11, 19)} ${s}`);

async function waitFor(
	paneId: string,
	pred: (r: Row, d: Detail) => boolean,
	ms: number,
	label: string
) {
	const until = Date.now() + ms;
	let last: [Row | undefined, Detail | undefined] = [undefined, undefined];
	let lastStatus = '';
	while (Date.now() < until) {
		const r = await row(paneId);
		const d = await detail(paneId).catch(() => undefined);
		last = [r, d];
		if (r && r.status !== lastStatus) {
			lastStatus = r.status;
			note(`status ${r.status}${d?.picker ? ' (picker on screen)' : ''}`);
		}
		if (r && d && pred(r, d)) return { ok: true, row: r, detail: d };
		await sleep(1500);
	}
	note(`timed out waiting for ${label}`);
	return { ok: false, row: last[0], detail: last[1] };
}

let paneId = '';
try {
	if (existingPane) {
		paneId = existingPane;
		note(`using pane ${paneId}`);
	} else {
		const started = Date.now();
		const created = await api<{ paneId?: string; message?: string }>('/api/agents/new', {
			method: 'POST',
			body: JSON.stringify({
				kind,
				cwd,
				label: `probe-${kind}`,
				prompt: kind === 'omp' ? START_PROMPT : undefined
			})
		});
		report.create = { status: created.status, body: created.body, ms: Date.now() - started };
		if (!created.body.paneId) throw new Error(`create failed: ${JSON.stringify(created.body)}`);
		paneId = created.body.paneId;
		const firstDetail = await detail(paneId);
		report.firstDetail = {
			status: firstDetail.status,
			degraded: firstDetail.degraded,
			degradedMessage: firstDetail.degradedMessage
		};
		if (kind === 'omp' && firstDetail.degraded !== 'none') {
			throw new Error(`first OMP detail degraded: ${firstDetail.degraded}`);
		}
		note(`pane ${paneId}`);
	}

	// 1. Reach idle (answering a first-run prompt with option 1 if one appears).
	const ready = await waitFor(
		paneId,
		(r, d) => r.status === 'idle' || (r.status === 'blocked' && !!d.picker),
		60_000,
		'idle'
	);
	if (ready.detail?.picker && ready.row?.status !== 'idle') {
		report.firstRunPicker = ready.detail.picker;
		// The trusting answer, wherever it sits: Claude lists "No, exit" first.
		const yes = ready.detail.picker.options.find((o) => /yes|trust|continue|allow/i.test(o.label));
		const answer = await api<unknown>(`/api/agents/${paneId}/answer`, {
			method: 'POST',
			body: JSON.stringify({ index: yes?.index ?? 1 })
		});
		note(`first-run answer -> ${answer.status} ${JSON.stringify(answer.body)}`);
		await waitFor(paneId, (r) => r.status === 'idle', 30_000, 'idle after first-run prompt');
		await sleep(3_000);
	}
	const atIdle = await detail(paneId);
	report.atIdle = {
		status: atIdle.status,
		degraded: atIdle.degraded,
		degradedMessage: atIdle.degradedMessage,
		statusLines: atIdle.statusLines,
		preview: (await row(paneId))?.preview
	};

	// 2. The probe prompt.
	const sent = await api(`/api/agents/${paneId}/prompt`, {
		method: 'POST',
		body: JSON.stringify({ text: PROMPT })
	});
	report.prompt = sent.status;
	note('prompt sent');

	// 3. Either a picker appears, or the agent finishes. The echoed prompt
	// contains both marker phrases, so only lines that are NOT the echo count.
	// A genuine reply is the marker on a line of its own; the echo wraps and
	// its fragments contain the words too.
	const replied = (text: string) =>
		text.split('\n').some((line) => /^\W*(PROBE OK|NO ASK TOOL)\W*$/.test(line.trim()));
	let sawWorking = false;
	const outcome = await waitFor(
		paneId,
		(r, d) => {
			if (r.status === 'working') sawWorking = true;
			return (
				!!d.picker ||
				(sawWorking &&
					r.status !== 'working' &&
					d.messages.some((m) => m.role === 'assistant' && replied(m.text)))
			);
		},
		120_000,
		'picker or reply'
	);
	report.sawWorking = sawWorking;
	const d1 = outcome.detail ?? (await detail(paneId));
	report.afterPrompt = {
		status: outcome.row?.status,
		degraded: d1.degraded,
		degradedMessage: d1.degradedMessage,
		messages: d1.messages.slice(-6).map((m) => ({
			role: m.role,
			text: m.text.slice(0, 120),
			tools: m.tools.map((t) => `${t.name} ${t.summary}`.trim().slice(0, 80))
		})),
		picker: d1.picker,
		statusLines: d1.statusLines,
		preview: (await row(paneId))?.preview,
		screenTail: d1.screenTail.split('\n').slice(-14).join('\n')
	};

	// 4. Answer the picker through bordr, as a tap would.
	if (d1.picker) {
		const answer = await api<{ chose?: string; outcome?: string; message?: string }>(
			`/api/agents/${paneId}/answer`,
			{ method: 'POST', body: JSON.stringify({ index: 2 }) }
		);
		note(`answer -> ${answer.status} ${JSON.stringify(answer.body)}`);
		const after = await waitFor(
			paneId,
			(r, d) => !d.picker && r.status !== 'working',
			60_000,
			'reply after answer'
		);
		const d2 = after.detail ?? (await detail(paneId));
		report.answered = {
			response: answer.body,
			status: after.row?.status,
			lastMessages: d2.messages.slice(-3).map((m) => `[${m.role}] ${m.text.slice(0, 120)}`)
		};
	}

	// 5. A slash-command menu: a simple /model becomes a picker; OMP's
	// two-column model browser stays in the key-driven peek.
	await api(`/api/agents/${paneId}/prompt`, {
		method: 'POST',
		body: JSON.stringify({ text: '/model' })
	});
	note('/model sent');
	const menu = await waitFor(paneId, (_r, d) => !!d.picker || !!d.menu, 8_000, '/model menu');
	report.modelMenu = {
		picker: menu.detail?.picker
			? {
					question: menu.detail.picker.question,
					options: menu.detail.picker.options.slice(0, 6).map((o) => o.label)
				}
			: null,
		menu: menu.detail?.menu ?? null,
		screenTail: menu.detail?.screenTail.split('\n').slice(-10).join('\n'),
		status: menu.row?.status
	};
	await api(`/api/agents/${paneId}/keys`, {
		method: 'POST',
		body: JSON.stringify({ keys: ['esc'] })
	});
	await sleep(1500);
	const closed = await detail(paneId);
	report.menuClosedByEsc = !closed.picker && !closed.menu;
} catch (e) {
	report.error = (e as Error).message;
} finally {
	if (paneId && !existingPane) {
		const workspace = paneId.split(':')[0];
		try {
			await herdr('workspace.close', { workspace_id: workspace });
			note('workspace closed');
		} catch (e) {
			note(`close failed: ${(e as Error).message}`);
		}
	}
	report.timeline = timeline;
	console.log(JSON.stringify(report, null, 2));
}
