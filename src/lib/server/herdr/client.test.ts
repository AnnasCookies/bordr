import { afterEach, describe, expect, it } from 'vitest';
import { unlinkSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { HerdrClient, HerdrRequestError } from './client';

const SOCK = '/tmp/bordr-test-herdr.sock';
let stop: (() => void) | undefined;
let connections: Socket[] = [];

/**
 * Mimics herdr's actual behaviour: each connection answers exactly one
 * request; anything after that on the same connection is ignored.
 */
function startFakeHerdr(
	handler: (req: { id: string; method: string; params?: unknown }) => unknown,
	opts: {
		/** Send the reply in two socket writes, split inside this glyph's UTF-8 bytes. */
		splitInside?: string;
		/** Hold the reply back this long, as herdr does while an agent starts. */
		delayMs?: number;
		/** Send this verbatim instead of a JSON frame — a socket that is not herdr. */
		rawReply?: string;
	} = {}
) {
	try {
		unlinkSync(SOCK);
	} catch {
		// no stale socket to remove
	}
	connections = [];
	const server = createServer((socket) => {
		connections.push(socket);
		let answered = false;
		socket.on('data', (data) => {
			for (const line of data.toString().split('\n')) {
				if (!line.trim() || answered) continue;
				answered = true;
				const req = JSON.parse(line);
				const reply = opts.rawReply ?? JSON.stringify(handler(req)) + '\n';
				const send = () => {
					if (!opts.splitInside) {
						socket.write(reply);
						return;
					}
					const bytes = Buffer.from(reply, 'utf8');
					const cut = bytes.indexOf(Buffer.from(opts.splitInside, 'utf8')) + 1;
					socket.write(bytes.subarray(0, cut));
					setTimeout(() => socket.write(bytes.subarray(cut)), 20);
				};
				if (opts.delayMs) setTimeout(send, opts.delayMs);
				else send();
			}
		});
	});
	server.listen(SOCK);
	return () => {
		for (const s of connections) s.destroy();
		server.close();
	};
}

afterEach(() => {
	stop?.();
	stop = undefined;
});

describe('HerdrClient.request', () => {
	it('resolves a request with its result', async () => {
		stop = startFakeHerdr((req) => ({ id: req.id, result: { type: 'pong' } }));
		const client = new HerdrClient(SOCK);
		await expect(client.request('ping')).resolves.toEqual({ type: 'pong' });
	});

	it('rejects with the herdr error code', async () => {
		stop = startFakeHerdr((req) => ({
			id: req.id,
			error: { code: 'invalid_request', message: 'missing field `pane_id`' }
		}));
		const client = new HerdrClient(SOCK);
		await expect(client.request('events.subscribe')).rejects.toThrow(HerdrRequestError);
	});

	it('serves concurrent requests on independent connections', async () => {
		stop = startFakeHerdr((req) => ({ id: req.id, result: { type: 'echo', method: req.method } }));
		const client = new HerdrClient(SOCK);
		const [a, b] = await Promise.all([client.request('agent.list'), client.request('pane.list')]);
		expect((a as { method: string }).method).toBe('agent.list');
		expect((b as { method: string }).method).toBe('pane.list');
		expect(connections).toHaveLength(2);
	});

	it('times out rather than hanging when herdr never answers', async () => {
		stop = startFakeHerdr(() => ({ id: 'mismatched', result: { type: 'lost' } }));
		const client = new HerdrClient(SOCK, 200);
		await expect(client.request('agent.read')).rejects.toThrow('timed out');
	});

	it('rejects when the socket path does not exist', async () => {
		const client = new HerdrClient('/tmp/bordr-no-such.sock', 500);
		await expect(client.request('ping')).rejects.toThrow();
	});

	it('reassembles a multi-byte glyph split across two socket reads', async () => {
		stop = startFakeHerdr((req) => ({ id: req.id, result: { type: 'read', text: 'done ✓' } }), {
			splitInside: '✓'
		});
		const client = new HerdrClient(SOCK);
		const result = await client.request<{ text: string }>('agent.read');
		expect(result.text).toBe('done ✓');
	});

	it('rejects, rather than crashing the process, when the peer is not herdr', async () => {
		stop = startFakeHerdr(() => ({}), { rawReply: 'HTTP/1.1 400 Bad Request\r\n\r\n' });
		const client = new HerdrClient(SOCK);
		const pending = client.request('ping');
		await expect(pending).rejects.toThrow(HerdrRequestError);
		await expect(pending).rejects.toMatchObject({ code: 'protocol_error' });
	});

	it('outlasts a timeout_ms the request hands to herdr', async () => {
		// herdr takes up to timeout_ms to answer agent.start; a client bound
		// shorter than that rejects while herdr is still legitimately busy.
		stop = startFakeHerdr((req) => ({ id: req.id, result: { type: 'started' } }), {
			delayMs: 150
		});
		const client = new HerdrClient(SOCK, 50);
		await expect(client.request('agent.start', { timeout_ms: 150 })).resolves.toEqual({
			type: 'started'
		});
	});

	it('still honours an explicit per-request timeout over the peer timeout', async () => {
		stop = startFakeHerdr((req) => ({ id: req.id, result: { type: 'started' } }), {
			delayMs: 300
		});
		const client = new HerdrClient(SOCK);
		await expect(client.request('agent.start', { timeout_ms: 300 }, 50)).rejects.toThrow(
			'timed out'
		);
	});
});

describe('HerdrClient.subscribe', () => {
	it('confirms the subscription, then streams events until closed', async () => {
		stop = startFakeHerdr((req) => ({ id: req.id, result: { type: 'subscription_started' } }));
		const client = new HerdrClient(SOCK);
		const seen: string[] = [];
		const close = await client.subscribe([{ type: 'pane.updated' }], (e) => seen.push(e.event));

		connections[0].write(
			JSON.stringify({ event: 'pane.updated', data: { type: 'pane_updated' } }) + '\n'
		);
		await new Promise((r) => setTimeout(r, 50));
		expect(seen).toEqual(['pane.updated']);
		close();
	});

	it('reports an unexpected stream death via onClose', async () => {
		stop = startFakeHerdr((req) => ({ id: req.id, result: { type: 'subscription_started' } }));
		const client = new HerdrClient(SOCK);
		let died = false;
		await client.subscribe(
			[{ type: 'pane.updated' }],
			() => {},
			() => {
				died = true;
			}
		);
		connections[0].destroy();
		await new Promise((r) => setTimeout(r, 50));
		expect(died).toBe(true);
	});

	it('does not fire onClose when closed deliberately', async () => {
		stop = startFakeHerdr((req) => ({ id: req.id, result: { type: 'subscription_started' } }));
		const client = new HerdrClient(SOCK);
		let died = false;
		const close = await client.subscribe(
			[{ type: 'pane.updated' }],
			() => {},
			() => {
				died = true;
			}
		);
		close();
		await new Promise((r) => setTimeout(r, 50));
		expect(died).toBe(false);
	});
});

describe('subscribe handshake bounds', () => {
	it('rejects rather than hanging when herdr accepts but never answers', async () => {
		// A peer that accepts the connection and stays silent: no data, no
		// error, no close. Without a handshake timer this promise never
		// settles and pins every recovery path off permanently.
		try {
			unlinkSync(SOCK);
		} catch {
			// nothing stale to remove
		}
		const silent = createServer(() => {});
		silent.listen(SOCK);
		const client = new HerdrClient(SOCK, 150);
		await expect(client.subscribe([{ type: 'pane.updated' }], () => {})).rejects.toThrow(
			'handshake timed out'
		);
		silent.close();
	});
});
