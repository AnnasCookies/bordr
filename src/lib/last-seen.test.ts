import { beforeEach, describe, expect, it } from 'vitest';
import { cachedAgents, cachedPanes, recall, remember } from './last-seen';

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

	it('refuses non-finite or future timestamps', () => {
		for (const at of ['1e400', String(Date.now() + 60_000)]) {
			store.set('bordr:last:panes', `{"at":${at},"value":1}`);
			expect(recall('panes')).toBeNull();
		}
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

const agent = {
	paneId: 'fixture:p1',
	agent: 'claude',
	title: 'fixture',
	cwd: '/fixture',
	seq: 1,
	status: 'blocked',
	workspaceId: 'w1',
	workspaceLabel: 'fixture',
	tabId: 'w1:t1',
	tabLabel: 'tab',
	preview: 'invented transcript text',
	picker: { question: 'Old question', options: [] },
	menu: 'old menu'
};

it('restores navigation metadata but never cached answers or transcript output', () => {
	const value = cachedAgents([agent]);
	expect(value?.[0]).toMatchObject({ paneId: 'fixture:p1', picker: null, menu: null });
	expect(JSON.stringify(value)).not.toContain('invented transcript text');
	expect(JSON.stringify(value)).not.toContain('Old question');
});

it('refuses malformed arrays and nested sidebar shapes before rendering', () => {
	for (const value of [{}, [null], [{ ...agent, seq: -1 }], [{ ...agent, title: 5 }]]) {
		expect(cachedAgents(value)).toBeNull();
	}
	for (const value of [null, {}, { workspaces: [{}] }, { workspaces: [null] }]) {
		expect(cachedPanes(value)).toBeNull();
	}
	const workspace = {
		workspaceId: 'w1',
		machine: '',
		label: 'fixture',
		branch: '',
		number: 1,
		ahead: 0,
		behind: 0,
		focused: false,
		tabs: []
	};
	expect(cachedPanes({ workspaces: [workspace] })?.workspaces).toEqual([workspace]);
	expect(cachedPanes({ workspaces: [{ ...workspace, tabs: [{}] }] })).toBeNull();
	expect(cachedPanes({ workspaces: [{ ...workspace, worktree: {} }] })).toBeNull();
});
