import { afterEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page';

/**
 * The load holds its last good payload in the browser only, and these tests
 * run under Node, where the real `browser` is false. A getter rather than a
 * value so one test can play the server's first render.
 */
const environment = vi.hoisted(() => ({ browser: true }));
vi.mock('$app/environment', () => ({
	get browser() {
		return environment.browser;
	}
}));
afterEach(() => {
	environment.browser = true;
});

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

describe('pane load: unchanged detail', () => {
	it('sends the held ETag and reuses the same detail object on 304', async () => {
		let detailCalls = 0;
		let conditional = '';
		const fetchStub = async (input: string | URL | Request, init?: RequestInit) => {
			const path = String(input);
			if (path.endsWith('/watch')) {
				return new Response(JSON.stringify({ watched: false }), { status: 200 });
			}
			detailCalls++;
			conditional = new Headers(init?.headers).get('if-none-match') ?? '';
			if (detailCalls === 1) {
				return new Response(JSON.stringify({ ...DETAIL, paneId: 'etag:p1' }), {
					status: 200,
					headers: { etag: '"same-detail"' }
				});
			}
			return new Response(null, { status: 304 });
		};
		const event = {
			params: { pane: 'etag:p1' },
			url: new URL('http://x/a/etag:p1'),
			fetch: fetchStub
		} as unknown as LoadEvent;

		const first = await load(event);
		const second = await load(event);
		if (!first || !second) throw new Error('load returned no data');
		expect(conditional).toBe('"same-detail"');
		expect(second.detail).toBe(first.detail);
	});

	it('holds nothing on the server, so the first render is never conditional', async () => {
		// The server's map outlived every request, and its ETag made the SSR
		// fetch conditional: the browser, with nothing held, could not repeat
		// that request, missed the inlined response and fetched it again.
		const conditionals: string[] = [];
		const fetchStub = async (input: string | URL | Request, init?: RequestInit) => {
			const path = String(input);
			if (path.endsWith('/watch')) {
				return new Response(JSON.stringify({ watched: false }), { status: 200 });
			}
			conditionals.push(new Headers(init?.headers).get('if-none-match') ?? '');
			return new Response(JSON.stringify({ ...DETAIL, paneId: 'ssr:p1' }), {
				status: 200,
				headers: { etag: '"ssr-detail"' }
			});
		};
		const event = {
			params: { pane: 'ssr:p1' },
			url: new URL('http://x/a/ssr:p1'),
			fetch: fetchStub
		} as unknown as LoadEvent;

		environment.browser = false;
		await load(event);
		await load(event);
		environment.browser = true;
		await load(event);
		// Neither server render sent an ETag, and the browser's first load found
		// nothing the server had left behind.
		expect(conditionals).toEqual(['', '', '']);
	});
});

describe('load: losing the connection', () => {
	/** A fetch that throws the way a real one does with no network. */
	const dead = () => Promise.reject(new TypeError('Failed to fetch'));

	const okDetail = (pane: string) =>
		new Response(JSON.stringify({ paneId: pane, messages: [], title: 'x' }), { status: 200 });
	const okWatch = () => new Response(JSON.stringify({ watched: false }), { status: 200 });

	function fetcher(mode: 'ok' | 'dead') {
		return (input: string | URL | Request) => {
			if (mode === 'dead') return dead();
			const url = String(input);
			return Promise.resolve(url.endsWith('/watch') ? okWatch() : okDetail('w1:p1'));
		};
	}

	const args = (fetchImpl: unknown) =>
		({
			params: { pane: 'w1:p1' },
			url: new URL('http://x/a/w1:p1'),
			fetch: fetchImpl
		}) as unknown as Parameters<typeof load>[0];

	/** `PageLoad` is typed `void | …`, which is not what this load returns. */
	type Loaded = { detail: unknown; watched: boolean; megabytes: number; offline: boolean };
	const run = async (fetchImpl: unknown) => (await load(args(fetchImpl))) as unknown as Loaded;

	it('keeps the last transcript when the network goes, instead of erroring', async () => {
		// The bug: a fetch that fails at the network layer throws rather than
		// returning a status, so a phone in a tunnel put a 500 page over the
		// whole app — transcript, composer and any draft in it.
		const first = await run(fetcher('ok'));
		expect(first.offline).toBe(false);

		const held = await run(fetcher('dead'));
		expect(held.offline).toBe(true);
		expect(held.detail).toEqual(first.detail);
	});

	it('does error when there is nothing held to show', async () => {
		// A pane never loaded has no last-good copy, so a blank error page is
		// the honest answer rather than an empty transcript.
		const fresh = {
			params: { pane: 'never:seen' },
			url: new URL('http://x/a/never:seen'),
			fetch: fetcher('dead')
		} as unknown as Parameters<typeof load>[0];
		await expect(load(fresh)).rejects.toMatchObject({ status: 503 });
	});
});
