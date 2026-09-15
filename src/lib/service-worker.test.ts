import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind } from 'typescript';
import * as notify from './notify';

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
	runInNewContext(compiled, {
		exports: {},
		console: { info: vi.fn() },
		require: (name: string) => (name === '$service-worker' ? { version: 'fixture-build' } : notify),
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
	for (const client of clients) {
		expect(client.postMessage).toHaveBeenCalledWith({
			type: 'bordr:updated',
			build: 'fixture-build'
		});
		expect(client.navigate).not.toHaveBeenCalled();
	}
});
