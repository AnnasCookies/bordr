import { connect, type Socket } from 'node:net';
import { HerdrRequestError } from './client';
import { CORE_GENERATION } from './compat';

/**
 * herdr-core's socket: JSON-RPC 2.0, one message per line ("plain mode"),
 * several calls per connection. `hello {framed: true}` switches a connection
 * to framed mode, which attach needs: `[channel u32 LE][kind u8][len u32 LE]`.
 * See herdr-core `schema/README.md`.
 */

const DATA = 0;
const CLOSE = 2;
const HEADER = 9;

interface RpcError {
	code: number;
	message: string;
	data?: { kind?: string; hint?: string };
}

interface RpcMessage {
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: RpcError;
}

function rpcError(method: string, error: RpcError): HerdrRequestError {
	return new HerdrRequestError(
		error.data?.kind ?? String(error.code),
		`${method}: ${error.message}`
	);
}

/** Split a plain-mode stream into JSON messages; a bad line is dropped, never thrown out of the emitter. */
function lineReader(onMessage: (m: RpcMessage) => void): (chunk: Buffer) => void {
	let buffer = '';
	return (chunk) => {
		buffer += chunk.toString('utf8');
		let nl: number;
		while ((nl = buffer.indexOf('\n')) !== -1) {
			const line = buffer.slice(0, nl);
			buffer = buffer.slice(nl + 1);
			if (!line.trim()) continue;
			try {
				onMessage(JSON.parse(line) as RpcMessage);
			} catch {
				// not JSON: some other daemon on the socket, or a torn line
			}
		}
	};
}

function request(id: number, method: string, params: unknown): string {
	return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

/** One call on its own connection. Cheap on a local socket, and it heals across core restarts. */
export function coreCall<T>(
	socketPath: string,
	method: string,
	params: unknown = {},
	timeoutMs = 10_000
): Promise<T> {
	return new Promise((resolve, reject) => {
		const socket = connect(socketPath);
		let settled = false;
		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			fn();
		};
		const timer = setTimeout(
			() => settle(() => reject(new Error(`herdr-core request timed out: ${method}`))),
			timeoutMs
		);
		socket.on('error', (e) => settle(() => reject(e)));
		socket.on('close', () =>
			settle(() => reject(new Error(`herdr-core closed the connection before answering ${method}`)))
		);
		socket.on(
			'data',
			lineReader((m) => {
				if (m.id !== 1) return;
				if (m.error) settle(() => reject(rpcError(method, m.error!)));
				else settle(() => resolve(m.result as T));
			})
		);
		socket.on('connect', () => socket.write(request(1, method, params)));
	});
}

/**
 * Follow `events.subscribe` in plain mode: the reply is a snapshot, then
 * every later line is a notification. Resolves with a close function once
 * the snapshot arrives.
 */
export function coreSubscribe(
	socketPath: string,
	onNote: (method: string, params: Record<string, unknown>) => void,
	onClose?: () => void,
	timeoutMs = 10_000
): Promise<{ close: () => void; snapshot: Record<string, unknown> }> {
	return new Promise((resolve, reject) => {
		const socket = connect(socketPath);
		// Never the reason the process stays alive (same rule as the TUI client).
		socket.unref();
		let started = false;
		let closedByUs = false;
		const timer = setTimeout(() => {
			socket.destroy();
			reject(new Error('herdr-core subscription handshake timed out'));
		}, timeoutMs);
		socket.on('error', (e) => {
			if (!started) {
				clearTimeout(timer);
				reject(e);
			}
		});
		socket.on('close', () => {
			if (!started) {
				clearTimeout(timer);
				reject(new Error('herdr-core closed the connection before the subscription started'));
			} else if (!closedByUs) onClose?.();
		});
		socket.on(
			'data',
			lineReader((m) => {
				if (m.id === 1) {
					clearTimeout(timer);
					if (m.error) {
						socket.destroy();
						reject(rpcError('events.subscribe', m.error));
						return;
					}
					started = true;
					resolve({
						snapshot: (m.result ?? {}) as Record<string, unknown>,
						close: () => {
							closedByUs = true;
							socket.destroy();
						}
					});
				} else if (m.method && started) onNote(m.method, m.params ?? {});
			})
		);
		socket.on('connect', () => socket.write(request(1, 'events.subscribe', {})));
	});
}

function frame(channel: number, kind: number, payload: Buffer): Buffer {
	const header = Buffer.alloc(HEADER);
	header.writeUInt32LE(channel, 0);
	header[4] = kind;
	header.writeUInt32LE(payload.length, 5);
	return Buffer.concat([header, payload]);
}

/**
 * Open a framed connection, attach to a terminal, hand the stream to `use`,
 * then detach. `use` gets the stream's bytes so far and a writer for keys,
 * and resolves when it is done.
 */
function withAttach<T>(
	socketPath: string,
	params: Record<string, unknown>,
	use: (stream: {
		received: () => Buffer;
		onData: (fn: () => void) => void;
		write: (bytes: Buffer) => void;
	}) => Promise<T>,
	timeoutMs = 5_000
): Promise<T> {
	return new Promise((resolve, reject) => {
		const socket: Socket = connect(socketPath);
		let buffer = Buffer.alloc(0);
		let framed = false;
		let channel = -1;
		let received = Buffer.alloc(0);
		let notify: (() => void) | undefined;
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (channel >= 0) socket.write(frame(channel, CLOSE, Buffer.alloc(0)));
			socket.end();
			setTimeout(() => socket.destroy(), 100).unref();
			fn();
		};
		const timer = setTimeout(
			() => finish(() => reject(new Error('herdr-core attach timed out'))),
			timeoutMs
		);
		socket.on('error', (e) => finish(() => reject(e)));
		socket.on('close', () =>
			finish(() => reject(new Error('herdr-core closed the attach connection')))
		);
		socket.on('connect', () =>
			socket.write(
				request(1, 'hello', { framed: true, generation: CORE_GENERATION, features: ['attach'] })
			)
		);
		socket.on('data', (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);
			if (!framed) {
				const nl = buffer.indexOf(10);
				if (nl === -1) return;
				let hello: RpcMessage;
				try {
					hello = JSON.parse(buffer.subarray(0, nl).toString('utf8')) as RpcMessage;
				} catch {
					finish(() => reject(new Error('herdr-core: bad hello reply')));
					return;
				}
				if (hello.error) {
					finish(() => reject(rpcError('hello', hello.error!)));
					return;
				}
				buffer = buffer.subarray(nl + 1);
				framed = true;
				const call = { jsonrpc: '2.0', id: 2, method: 'terminal.attach', params };
				socket.write(frame(0, DATA, Buffer.from(JSON.stringify(call))));
			}
			while (buffer.length >= HEADER) {
				const ch = buffer.readUInt32LE(0);
				const kind = buffer[4];
				const len = buffer.readUInt32LE(5);
				if (buffer.length < HEADER + len) return;
				const payload = buffer.subarray(HEADER, HEADER + len);
				buffer = buffer.subarray(HEADER + len);
				if (ch === 0 && kind === DATA) {
					let m: RpcMessage;
					try {
						m = JSON.parse(payload.toString('utf8')) as RpcMessage;
					} catch {
						continue;
					}
					if (m.id !== 2) continue;
					if (m.error) {
						finish(() => reject(rpcError('terminal.attach', m.error!)));
						return;
					}
					channel = Number((m.result as { channel?: unknown })?.channel);
					use({
						received: () => received,
						onData: (fn) => {
							notify = fn;
						},
						write: (bytes) => socket.write(frame(channel, DATA, bytes))
					}).then(
						(value) => finish(() => resolve(value)),
						(e) => finish(() => reject(e))
					);
				} else if (ch === channel && kind === DATA) {
					received = Buffer.concat([received, payload]);
					notify?.();
				} else if (ch === channel && kind === CLOSE) {
					// The program ended mid-read: what arrived is what there is.
					notify?.();
				}
			}
		});
	});
}

/** The first paint ends with the 9001 mode report (schema README: "Attach streams"). */
// eslint-disable-next-line no-control-regex -- matching terminal output means matching escapes
const PAINT_END = /\x1b\[\?9001[hl]/;

/**
 * The terminal's screen with its colour, as the first paint of a watch-only
 * attach. `observe` never types or resizes, so nobody's terminal changes.
 */
export function corePaint(
	socketPath: string,
	terminal: string,
	history = 0,
	timeoutMs = 3_000
): Promise<string> {
	return withAttach(
		socketPath,
		{ terminal, observe: true, history, cols: 80, rows: 24 },
		({ received, onData }) =>
			new Promise<string>((resolve) => {
				const check = () => {
					const text = received().toString('utf8');
					if (PAINT_END.test(text)) resolve(text);
				};
				// Fallback for a core that ends its paint differently: take what came.
				const quiet = setTimeout(() => resolve(received().toString('utf8')), timeoutMs - 500);
				quiet.unref();
				onData(check);
				check();
			}),
		timeoutMs
	);
}

/**
 * Type text into a terminal without pressing Enter, as a person at it would.
 *
 * Core's `terminal.keys` takes key NAMES (no `!`, no spaces in text), and
 * `terminal.send` always presses Enter, so plain typing goes over an attach.
 * Attaching as a viewer makes us the size owner, so we attach at the
 * terminal's own size: nobody's window changes.
 */
export function coreType(
	socketPath: string,
	terminal: string,
	text: string,
	size: { cols: number; rows: number }
): Promise<void> {
	return withAttach(
		socketPath,
		{ terminal, cols: size.cols, rows: size.rows },
		async ({ write }) => {
			write(Buffer.from(text, 'utf8'));
		}
	);
}
