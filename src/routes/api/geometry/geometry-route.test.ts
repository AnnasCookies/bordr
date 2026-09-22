import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HerdrHangupError, HerdrRequestError } from '$lib/server/herdr/client';

const herdr = vi.hoisted(() => ({
	request: vi.fn(),
	clientFor: vi.fn()
}));
vi.mock('$lib/server/herdr', async () => ({
	HerdrRequestError: (await import('$lib/server/herdr/client')).HerdrRequestError,
	clientFor: herdr.clientFor
}));

const { POST } = await import('./+server');

const CLAIM = {
	action: 'claim',
	tabId: 'w1:t1',
	ownerId: 'bordr:test',
	cols: 120,
	rows: 40,
	cellWidthPx: 8,
	cellHeightPx: 16
};

/** The status the browser sees, whether the route returned or threw an HttpError. */
async function status(body: unknown): Promise<number> {
	const request = new Request('http://bordr.test/api/geometry', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	try {
		return (await POST({ request } as never)).status;
	} catch (e) {
		if (typeof e === 'object' && e !== null && 'status' in e) return Number(e.status);
		throw e;
	}
}

beforeEach(() => {
	herdr.request.mockReset();
	herdr.clientFor.mockReset();
	herdr.clientFor.mockResolvedValue({ request: herdr.request });
});

describe('POST /api/geometry', () => {
	it('rejects malformed JSON and a malformed body before reaching Herdr', async () => {
		expect(await status('{')).toBe(400);
		expect(await status({ ...CLAIM, tabId: 42 })).toBe(400);
		expect(await status({ ...CLAIM, action: 'steal' })).toBe(400);
		expect(await status({ ...CLAIM, action: 'update' })).toBe(400);
		expect(herdr.clientFor).not.toHaveBeenCalled();
	});

	it('forwards a claim for the tab on its own machine', async () => {
		herdr.request.mockResolvedValue({ type: 'tab_viewport_lease', lease_id: 'lease-1' });
		expect(await status({ ...CLAIM, tabId: 'tm-dev~w1:t1' })).toBe(200);
		expect(herdr.clientFor).toHaveBeenCalledWith('tm-dev');
		expect(herdr.request).toHaveBeenCalledWith(
			'tab.viewport.claim',
			expect.objectContaining({ owner_id: 'bordr:test', tab_id: 'w1:t1', cols: 120 })
		);
	});

	it('reports a Herdr without the lease methods as unsupported', async () => {
		herdr.request.mockRejectedValue(
			new HerdrRequestError(
				'invalid_request',
				'unknown variant `tab.viewport.claim`, expected one of `ping`, `pane.list`'
			)
		);
		expect(await status(CLAIM)).toBe(501);
	});

	it('keeps any other invalid request a 400, so leasing is not switched off', async () => {
		herdr.request.mockRejectedValue(
			new HerdrRequestError('invalid_request', 'missing field `pane_id`')
		);
		expect(await status(CLAIM)).toBe(400);
	});

	it('passes a lease conflict through as 409', async () => {
		herdr.request.mockRejectedValue(new HerdrRequestError('viewport_busy', 'held by bordr:other'));
		expect(await status(CLAIM)).toBe(409);
	});

	it('answers 503 for a machine that cannot be reached', async () => {
		herdr.clientFor.mockRejectedValue(
			new HerdrRequestError('machine_unreachable', 'machine tm-dev is not reachable')
		);
		expect(await status({ ...CLAIM, tabId: 'tm-dev~w1:t1' })).toBe(503);
	});

	// Stable Herdr 0.9.1 has no lease methods and, unlike earlier builds, hangs
	// up on an unknown method instead of naming it. Read as "unreachable", the
	// browser retried the claim for ever; a live ping proves it is unsupported.
	it('reports a Herdr that hangs up on the lease method but answers ping as unsupported', async () => {
		herdr.request.mockImplementation(async (method: string) => {
			if (method === 'ping') return { type: 'pong', version: '0.9.1', protocol: 22 };
			throw new HerdrHangupError(method);
		});
		expect(await status(CLAIM)).toBe(501);
		expect(herdr.request).toHaveBeenCalledWith('ping', {}, expect.any(Number));
	});

	it('keeps a hang-up a 503 when Herdr does not answer ping either', async () => {
		herdr.request.mockImplementation(async (method: string) => {
			throw new HerdrHangupError(method);
		});
		expect(await status(CLAIM)).toBe(503);
	});
});
