import { error, json } from '@sveltejs/kit';
import { clientFor, HerdrRequestError } from '$lib/server/herdr';
import { parsePane } from '$lib/server/herdr/address';
import type { RequestHandler } from './$types';

interface GeometryBody {
	action?: unknown;
	tabId?: unknown;
	ownerId?: unknown;
	leaseId?: unknown;
	cols?: unknown;
	rows?: unknown;
	cellWidthPx?: unknown;
	cellHeightPx?: unknown;
}

function integer(value: unknown, name: string, min: number, max: number): number {
	if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
		throw error(400, `${name} must be an integer between ${min} and ${max}`);
	}
	return Number(value);
}

function text(value: unknown, name: string, max: number): string {
	if (typeof value !== 'string' || !value || value.length > max) {
		throw error(400, `${name} must contain between 1 and ${max} characters`);
	}
	return value;
}

/**
 * Herdr names an unknown method in serde's "unknown variant `tab.viewport.…`".
 * `invalid_request` alone is not enough: Herdr also uses it for parameter
 * errors such as "missing field `pane_id`", and reading one of those as
 * unsupported would switch leasing off in the browser for good.
 */
const UNKNOWN_METHOD = /unknown variant\W*tab\.viewport\./;

function herdrError(e: unknown): never {
	if (e instanceof HerdrRequestError) {
		if (
			e.code === 'viewport_busy' ||
			e.code === 'viewport_not_owned' ||
			e.code === 'viewport_expired'
		) {
			throw error(409, `${e.code}: ${e.message}`);
		}
		if (UNKNOWN_METHOD.test(e.message)) {
			throw error(501, 'this Herdr build does not support tab viewport leases');
		}
		// `clientFor` names a configured machine it cannot reach this way.
		if (e.code === 'machine_unreachable') {
			throw error(503, `herdr is not reachable: ${e.message}`);
		}
		throw error(400, `${e.code}: ${e.message}`);
	}
	if (e instanceof Error) throw error(503, `herdr is not reachable: ${e.message}`);
	throw e;
}

async function forward(machineId: string, method: string, params: Record<string, unknown>) {
	try {
		const herdr = await clientFor(machineId);
		return json(await herdr.request(method, params));
	} catch (e) {
		herdrError(e);
	}
}

/**
 * Own Herdr's canonical tab grid while a desktop Bordr split is on screen.
 *
 * The browser holds the opaque lease token. This route only validates and
 * forwards it; expiry in Herdr is the safety net when a browser disappears.
 */
export const POST: RequestHandler = async ({ request }) => {
	let body: GeometryBody;
	try {
		body = (await request.json()) as GeometryBody;
	} catch {
		throw error(400, 'request must be JSON');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw error(400, 'request must be an object');
	}
	const { action } = body;
	if (action !== 'claim' && action !== 'update' && action !== 'release') {
		throw error(400, 'action must be claim, update or release');
	}
	const { machineId, paneId: tabId } = parsePane(text(body.tabId, 'tabId', 256));

	if (action === 'release') {
		return forward(machineId, 'tab.viewport.release', {
			lease_id: text(body.leaseId, 'leaseId', 256)
		});
	}

	const geometry = {
		cols: integer(body.cols, 'cols', 10, 1000),
		rows: integer(body.rows, 'rows', 3, 500),
		cell_width_px: integer(body.cellWidthPx ?? 0, 'cellWidthPx', 0, 1000),
		cell_height_px: integer(body.cellHeightPx ?? 0, 'cellHeightPx', 0, 1000),
		ttl_ms: 15_000
	};
	if (action === 'claim') {
		return forward(machineId, 'tab.viewport.claim', {
			owner_id: text(body.ownerId, 'ownerId', 128),
			tab_id: tabId,
			...geometry
		});
	}
	return forward(machineId, 'tab.viewport.update', {
		lease_id: text(body.leaseId, 'leaseId', 256),
		...geometry
	});
};
