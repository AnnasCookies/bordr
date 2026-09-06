import { describe, expect, it } from 'vitest';
import { load } from './+page';

type LoadEvent = Parameters<typeof load>[0];

const DETAIL = { paneId: 'wC:p1', agent: 'omp', status: 'done', title: '', messages: [] };

/**
 * The real load event carries a dozen fields this load never reads; building all
 * of them would bury the two that matter. Unexpressible partial — cast once here.
 */
function eventWith(watch: { ok: boolean; body: unknown }, search = ''): LoadEvent {
	const fetchStub = async (url: string | URL): Promise<Response> => {
		const path = String(url);
		if (path.includes('/watch')) {
			return new Response(JSON.stringify(watch.body), { status: watch.ok ? 200 : 500 });
		}
		requested.push(path);
		return new Response(JSON.stringify(DETAIL), { status: 200 });
	};
	return {
		params: { pane: 'wC:p1' },
		url: new URL(`http://x/a/wC:p1${search}`),
		fetch: fetchStub
	} as unknown as LoadEvent;
}

/** Detail URLs the load asked for, so the window can be asserted. */
let requested: string[] = [];

/**
 * `PageLoad` permits returning nothing, so every call site is `data | void`.
 * Assert the data once here rather than casting at each expectation — a cast
 * would also swallow a real regression to a page that loads nothing.
 */
async function runLoad(watch: { ok: boolean; body: unknown }, search = '') {
	requested = [];
	const data = await load(eventWith(watch, search));
	if (!data) throw new Error('load returned no data');
	return data;
}

describe('pane load: watched flag', () => {
	it('seeds watched from the server so the bell cannot show 🔕 while armed', async () => {
		const data = await runLoad({ ok: true, body: { watched: true } });
		expect(data.watched).toBe(true);
	});

	it('reports an unwatched pane as false', async () => {
		const data = await runLoad({ ok: true, body: { watched: false } });
		expect(data.watched).toBe(false);
	});

	it('falls back to false when the watch lookup fails, still returning the transcript', async () => {
		const data = await runLoad({ ok: false, body: { watched: true } });
		expect(data.watched).toBe(false);
		expect(data.detail.paneId).toBe('wC:p1');
	});

	it('treats a malformed watch body as unwatched rather than trusting its shape', async () => {
		const data = await runLoad({ ok: true, body: { enabled: 'yes' } });
		expect(data.watched).toBe(false);
	});
});

describe('pane load: how far back to read', () => {
	const OK = { ok: true, body: { watched: false } };

	it('reads the default one-megabyte window when no window is asked for', async () => {
		const data = await runLoad(OK);
		expect(data.megabytes).toBe(1);
		expect(requested[0]).toContain(`bytes=${1024 * 1024}`);
	});

	it('honours a widened window so paging back survives an SSE refresh', async () => {
		const data = await runLoad(OK, '?w=4');
		expect(data.megabytes).toBe(4);
		expect(requested[0]).toContain(`bytes=${4 * 1024 * 1024}`);
	});

	it('falls back to the default rather than reading nothing on a junk window', async () => {
		for (const search of ['?w=0', '?w=-3', '?w=abc', '?w=']) {
			const data = await runLoad(OK, search);
			expect(data.megabytes).toBe(1);
		}
	});
});
