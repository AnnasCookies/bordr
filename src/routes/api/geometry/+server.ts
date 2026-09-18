import { error, json } from '@sveltejs/kit';
import { clientFor, HerdrRequestError } from '$lib/server/herdr';
import { parsePane } from '$lib/server/herdr/address';
import type { RequestHandler } from './$types';

interface GeometryBody {
	action?: 'claim' | 'update' | 'release';
	tabId?: string;
	ownerId?: string;
	leaseId?: string;
	cols?: number;
	rows?: number;
	cellWidthPx?: number;
	cellHeightPx?: number;
}

function integer(value: unknown, name: string, min: number, max: number): number {
	if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
		throw error(400, `${name} must be an integer between ${min} and ${max}`);
	}
	return Number(value);
}

function herdrError(e: unknown): never {
	if (e instanceof HerdrRequestError) {
		if (
			e.code === 'viewport_busy' ||
			e.code === 'viewport_not_owned' ||
			e.code === 'viewport_expired'
		) {
			throw error(409, `${e.code}: ${e.message}`);
		}
		if (e.code === 'invalid_request' || e.message.includes('unknown variant')) {
			throw error(501, 'this Herdr build does not support tab viewport leases');
		}
		throw error(400, `${e.code}: ${e.message}`);
	}
	if (e instanceof Error) throw error(503, `herdr is not reachable: ${e.message}`);
	throw e;
}

/**
 * Own Herdr's canonical tab grid while a desktop Bordr split is on screen.
 *
 * The browser holds the opaque lease token. This route only validates and
 * forwards it; expiry in Herdr is the safety net when a browser disappears.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as GeometryBody;
	if (!body.action) throw error(400, 'action is required');
	if (!body.tabId) throw error(400, 'tabId is required');
	const { machineId, paneId: tabId } = parsePane(body.tabId);

	try {
		const herdr = await clientFor(machineId);
		if (body.action === 'release') {
			if (!body.leaseId) throw error(400, 'leaseId is required');
			return json(
				await herdr.request('tab.viewport.release', {
					lease_id: body.leaseId
				})
			);
		}

		const geometry = {
			cols: integer(body.cols, 'cols', 10, 1000),
			rows: integer(body.rows, 'rows', 3, 500),
			cell_width_px: integer(body.cellWidthPx ?? 0, 'cellWidthPx', 0, 1000),
			cell_height_px: integer(body.cellHeightPx ?? 0, 'cellHeightPx', 0, 1000),
			ttl_ms: 15_000
		};
		if (body.action === 'claim') {
			if (!body.ownerId || body.ownerId.length > 128) {
				throw error(400, 'ownerId must contain between 1 and 128 characters');
			}
			return json(
				await herdr.request('tab.viewport.claim', {
					owner_id: body.ownerId,
					tab_id: tabId,
					...geometry
				})
			);
		}
		if (body.action === 'update') {
			if (!body.leaseId) throw error(400, 'leaseId is required');
			return json(
				await herdr.request('tab.viewport.update', {
					lease_id: body.leaseId,
					...geometry
				})
			);
		}
		throw error(400, 'unknown geometry action');
	} catch (e) {
		if (typeof e === 'object' && e !== null && 'status' in e) throw e;
		herdrError(e);
	}
};
