import { beforeEach, describe, expect, it } from 'vitest';
import { recall, remember } from './last-seen';

const store = new Map<string, string>();
beforeEach(() => {
	store.clear();
	globalThis.localStorage = {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v)
	} as unknown as Storage;
});

describe('last seen', () => {
	it('gives back what was stored', () => {
		remember('panes', { workspaces: [1] });
		expect(recall('panes')).toEqual({ workspaces: [1] });
	});

	it('drops a copy older than six hours', () => {
		remember('panes', 1);
		expect(recall('panes', Date.now() + 6 * 60 * 60 * 1000 + 1000)).toBeNull();
	});

	it('says nothing, rather than throwing, on garbage or blocked storage', () => {
		store.set('bordr:last:panes', '{nope');
		expect(recall('panes')).toBeNull();
		globalThis.localStorage = {
			getItem: () => {
				throw new Error('blocked');
			}
		} as unknown as Storage;
		expect(recall('panes')).toBeNull();
		expect(() => remember('x', 1)).not.toThrow();
	});
});
