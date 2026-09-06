import { projector, type Projection } from '$lib/server/projector';
import type { RequestHandler } from './$types';

/**
 * Live state for a browser.
 *
 * All the coalescing, deduping and herdr I/O lives in the shared projector,
 * so N phones cost one set of reads rather than N. This handler is only a
 * transport: subscribe, serialise, unsubscribe.
 */
export const GET: RequestHandler = async () => {
	let unsubscribe: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let closed = false;

	// Idempotent: reached from cancel() when the phone goes away, and from a
	// failed enqueue when the stream is already gone underneath us. Either
	// way the subscriber and the heartbeat must not outlive the connection,
	// or every dropped phone leaves a listener the projector keeps feeding.
	const teardown = () => {
		if (closed) return;
		closed = true;
		unsubscribe?.();
		unsubscribe = undefined;
		if (heartbeat) clearInterval(heartbeat);
		heartbeat = undefined;
	};

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();

			const send = (event: string, data: unknown) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					teardown();
				}
			};

			const publish = (p: Projection) => {
				send('agents', p.agents);
				send('read', p.read);
				send('compat', p.compat);
			};

			const onProjection = (p: Projection) => publish(p);
			unsubscribe = () => projector.unsubscribe(onProjection);

			try {
				publish(await projector.subscribe(onProjection));
			} catch (e) {
				// Never fail the response: EventSource treats a non-200 as fatal
				// and never retries, which strands the phone on frozen state.
				// The subscription stays registered; the projector retries the
				// wiring itself and feeds this stream once herdr is back.
				send('compat', {
					level: 'unreachable',
					version: null,
					protocol: null,
					message: `herdr is not reachable: ${(e as Error).message}`
				});
			}

			// The stream may have died during the first publish — no heartbeat
			// for a connection that is already torn down.
			if (closed) return;

			// MUST stay under the server's idle timeout, which svelte-adapter-bun
			// defaults to 10s (IDLE_TIMEOUT). At 20s the stream was killed before
			// a single ping arrived: measured dying at 9.06s direct to Bun and
			// ~12s through tailscale serve, every time, so the phone reconnected
			// every ten seconds all day and flashed "bordr unreachable".
			// unref'd: an open stream must never hold the process open.
			heartbeat = setInterval(() => send('ping', Date.now()), 5_000);
			(heartbeat as unknown as { unref?: () => void }).unref?.();
		},

		cancel() {
			teardown();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	});
};
