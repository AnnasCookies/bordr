import { connect } from 'node:net';
import {
	createDecoder,
	encode,
	isError,
	isEvent,
	type HerdrEvent,
	type HerdrFrame
} from './protocol';

export class HerdrRequestError extends Error {
	constructor(
		public code: string,
		message: string
	) {
		super(message);
		this.name = 'HerdrRequestError';
	}
}

let seq = 0;

/**
 * Headroom over a timeout herdr was handed in the request itself. herdr
 * answers `agent.start` only once the agent is up or its own `timeout_ms`
 * has elapsed, so a client bound shorter than that rejects here while herdr
 * is still legitimately busy.
 */
const PEER_TIMEOUT_GRACE_MS = 5_000;

function peerTimeout(params: unknown): number | undefined {
	if (typeof params !== 'object' || params === null || !('timeout_ms' in params)) return undefined;
	return typeof params.timeout_ms === 'number'
		? params.timeout_ms + PEER_TIMEOUT_GRACE_MS
		: undefined;
}

/**
 * herdr's socket API answers exactly ONE request per connection — a second
 * request on the same connection gets silence (verified against protocol 20,
 * 2026-08-24). So request() opens a fresh connection each time (sub-millisecond
 * on a local Unix socket, and self-healing across herdr restarts), and
 * subscribe() holds a dedicated connection that becomes a pure event stream.
 */
/**
 * herdr closed the socket without answering. Stable 0.9.1 does this for a
 * method it does not know, where earlier builds answered `unknown variant`, so
 * a hang-up alone cannot tell "unsupported" from "herdr went away".
 */
export class HerdrHangupError extends Error {
	constructor(readonly method: string) {
		super(`herdr closed the connection before answering ${method}`);
		this.name = 'HerdrHangupError';
	}
}

export class HerdrClient {
	constructor(
		readonly socketPath: string,
		private timeoutMs = 10_000
	) {}

	/**
	 * `timeoutMs` bounds this one request. Left unset, a `timeout_ms` the
	 * request carries for herdr is honoured (plus grace), then the client
	 * default.
	 */
	request<T = Record<string, unknown>>(
		method: string,
		params: unknown = {},
		timeoutMs: number = peerTimeout(params) ?? this.timeoutMs
	): Promise<T> {
		const id = `bordr-${++seq}`;
		return new Promise((resolve, reject) => {
			const socket = connect(this.socketPath);
			const decode = createDecoder();
			let settled = false;

			const settle = (fn: () => void) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				socket.destroy();
				fn();
			};

			const timer = setTimeout(
				() => settle(() => reject(new Error(`herdr request timed out: ${method}`))),
				timeoutMs
			);

			socket.on('error', (e) => settle(() => reject(e)));
			socket.on('close', () => settle(() => reject(new HerdrHangupError(method))));
			socket.on('data', (data) => {
				let frames: HerdrFrame[];
				try {
					frames = decode(data);
				} catch (e) {
					// A throw here would escape the event emitter and take the
					// process down — the outcome when HERDR_SOCKET points at some
					// other daemon. Reject the request instead.
					const detail = e instanceof Error ? e.message : String(e);
					settle(() => reject(new HerdrRequestError('protocol_error', `${method}: ${detail}`)));
					return;
				}
				for (const frame of frames) {
					if (isEvent(frame) || frame.id !== id) continue;
					if (isError(frame)) {
						settle(() => reject(new HerdrRequestError(frame.error.code, frame.error.message)));
					} else {
						settle(() => resolve(frame.result as T));
					}
					return;
				}
			});
			socket.on('connect', () => socket.write(encode({ id, method, params })));
		});
	}

	/**
	 * Open a dedicated event-stream connection. Resolves with a close function
	 * once herdr confirms the subscription; every subsequent frame on the
	 * connection is an event. onClose fires if the stream dies without close()
	 * being called — the caller decides whether to re-establish.
	 */
	subscribe(
		subscriptions: Array<Record<string, unknown>>,
		onEvent: (e: HerdrEvent) => void,
		onClose?: () => void
	): Promise<() => void> {
		return new Promise((resolve, reject) => {
			const socket = connect(this.socketPath);
			// This socket must never be the reason the process stays alive:
			// after a graceful shutdown it alone kept Bun's event loop open,
			// leaving a live-but-deaf process that Restart=always can never
			// replace. unref does not stop it receiving while the HTTP server
			// holds the loop open.
			socket.unref();
			const decode = createDecoder();
			let started = false;
			let closedByUs = false;

			// The handshake needs the same bound request() has: herdr can
			// accept a connection and never answer, and an unsettled promise
			// here pins SubscriptionManager.reviving forever — killing the
			// only recovery path that does not depend on the stream. Cleared
			// once streaming starts; the stream itself stays unbounded.
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error('herdr subscription handshake timed out'));
			}, this.timeoutMs);
			const fail = (e: Error) => {
				clearTimeout(timer);
				reject(e);
			};

			socket.on('error', (e) => {
				if (!started) fail(e);
			});
			socket.on('close', () => {
				if (!started)
					fail(new Error('herdr closed the connection before the subscription started'));
				else if (!closedByUs) onClose?.();
			});
			socket.on('data', (data) => {
				let frames: HerdrFrame[];
				try {
					frames = decode(data);
				} catch (e) {
					// Same escape hatch as request(): never let a bad frame throw
					// out of the emitter. Before the handshake this rejects; after
					// it, destroying the socket fires onClose and the manager's
					// heartbeat decides whether to try again.
					const detail = e instanceof Error ? e.message : String(e);
					fail(new HerdrRequestError('protocol_error', `events.subscribe: ${detail}`));
					socket.destroy();
					return;
				}
				for (const frame of frames) {
					if (isEvent(frame)) {
						onEvent(frame);
						continue;
					}
					if (isError(frame)) {
						fail(new HerdrRequestError(frame.error.code, frame.error.message));
						socket.destroy();
						return;
					}
					started = true;
					clearTimeout(timer);
					resolve(() => {
						closedByUs = true;
						socket.destroy();
					});
				}
			});
			socket.on('connect', () =>
				socket.write(
					encode({
						id: `bordr-sub-${++seq}`,
						method: 'events.subscribe',
						params: { subscriptions }
					})
				)
			);
		});
	}
}
