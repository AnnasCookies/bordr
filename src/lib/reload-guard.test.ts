import { describe, expect, it } from 'vitest';
import { IDLE_MS, mayReload, type ReloadMoment } from './reload-guard.svelte';

const moment = (over: Partial<ReloadMoment> = {}): ReloadMoment => ({
	stale: true,
	held: false,
	busy: false,
	typing: false,
	hidden: false,
	idleMs: IDLE_MS,
	...over
});

describe('mayReload', () => {
	it('reloads a stale page nobody has touched for the idle period', () => {
		expect(mayReload(moment())).toBe(true);
	});

	it('reloads a stale page in the background straight away', () => {
		expect(mayReload(moment({ hidden: true, idleMs: 0 }))).toBe(true);
	});

	it('never reloads a page that is up to date', () => {
		expect(mayReload(moment({ stale: false, hidden: true }))).toBe(false);
	});

	it('waits while the page is being used', () => {
		expect(mayReload(moment({ idleMs: IDLE_MS - 1 }))).toBe(false);
	});

	it('leaves it to the banner whenever a reload would lose something', () => {
		for (const loss of [{ held: true }, { busy: true }, { typing: true }]) {
			expect(mayReload(moment({ ...loss, hidden: true }))).toBe(false);
		}
	});
});
