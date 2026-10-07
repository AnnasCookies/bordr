import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind } from 'typescript';
import * as notify from './notify';

type Handler = (event: unknown) => void;

function loadWorker(extra: Record<string, unknown> = {}) {
	const listeners = new Map<string, Handler>();
	const source = readFileSync(new URL('../service-worker.ts', import.meta.url), 'utf8');
	const compiled = transpileModule(source, {
		compilerOptions: { module: ModuleKind.CommonJS }
	}).outputText;
	runInNewContext(compiled, {
		exports: {},
		URL,
		console: { info: vi.fn() },
		require: (name: string) =>
			name === '$service-worker'
				? {
						version: 'fixture-build',
						build: ['/_app/immutable/a.js'],
						files: ['/fonts/x.woff2', '/logo.png']
					}
				: notify,
		self: {
			location: { origin: 'https://bordr.test' },
			navigator: { userAgent: 'fixture' },
			addEventListener: (name: string, listener: Handler) => listeners.set(name, listener),
			clients: { claim: async () => {}, matchAll: async () => [] }
		},
		...extra
	});
	return listeners;
}

it("serves only the build's own files from the phone, never the page or the API", () => {
	const listeners = loadWorker({
		fetch: async () => ({ ok: true, clone: () => ({}) }),
		caches: { open: async () => ({ match: async () => undefined, put: async () => {} }) }
	});
	const seen = (path: string, init: { method?: string; range?: boolean } = {}) => {
		const respondWith = vi.fn();
		listeners.get('fetch')!({
			request: {
				url: `https://bordr.test${path}`,
				method: init.method ?? 'GET',
				headers: { has: () => init.range === true }
			},
			respondWith
		});
		return respondWith.mock.calls.length === 1;
	};
	expect(seen('/_app/immutable/a.js')).toBe(true);
	expect(seen('/fonts/x.woff2')).toBe(true);
	expect(seen('/')).toBe(false);
	expect(seen('/api/events')).toBe(false);
	expect(seen('/logo.png')).toBe(false);
	expect(seen('/_app/immutable/a.js', { method: 'POST' })).toBe(false);
	expect(seen('/_app/immutable/a.js', { range: true })).toBe(false);
});

it('activation notifies hidden and visible clients without destroying their drafts or uploads', async () => {
	const listeners = new Map<
		string,
		(event: { waitUntil: (work: Promise<void>) => void }) => void
	>();
	const clients = ['visible', 'hidden'].map((visibilityState) => ({
		visibilityState,
		postMessage: vi.fn(),
		navigate: vi.fn()
	}));
	const source = readFileSync(new URL('../service-worker.ts', import.meta.url), 'utf8');
	const compiled = transpileModule(source, {
		compilerOptions: { module: ModuleKind.CommonJS }
	}).outputText;
	const deleted: string[] = [];
	runInNewContext(compiled, {
		exports: {},
		console: { info: vi.fn() },
		caches: {
			keys: async () => ['bordr-assets-old-build', 'bordr-assets-fixture-build', 'bordr-state'],
			delete: async (key: string) => void deleted.push(key)
		},
		require: (name: string) =>
			name === '$service-worker' ? { version: 'fixture-build', build: [], files: [] } : notify,
		self: {
			navigator: { userAgent: 'fixture' },
			addEventListener: (
				name: string,
				listener: (event: { waitUntil: (work: Promise<void>) => void }) => void
			) => listeners.set(name, listener),
			clients: { claim: async () => {}, matchAll: async () => clients }
		}
	});
	let pending: Promise<void> | undefined;
	listeners.get('activate')!({
		waitUntil: (work) => {
			pending = work;
		}
	});
	await pending;
	// Only a previous build's asset cache goes; this build's and the state cache stay.
	expect(deleted).toEqual(['bordr-assets-old-build']);
	for (const client of clients) {
		expect(client.postMessage).toHaveBeenCalledWith({
			type: 'bordr:updated',
			build: 'fixture-build'
		});
		expect(client.navigate).not.toHaveBeenCalled();
	}
});
