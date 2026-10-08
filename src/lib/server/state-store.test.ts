import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
	isWatched,
	markRead,
	readState,
	seenStatus,
	saveJson,
	setWatched,
	watchedPanes
} from './state-store';

const remote = vi.hoisted(() => ({ target: 'fixture-a', session: 'main' }));
vi.mock('./herdr/machines', () => ({
	listMachines: () => [{ id: 'remote', label: 'remote', enabled: true, ...remote }]
}));

const DATA_DIR = process.env.BORDR_DATA_DIR;

beforeEach(() => {
	// Guard against regressing to the live directory: this suite deletes
	// what it points at, and the service's WorkingDirectory is the checkout.
	if (!DATA_DIR || DATA_DIR.startsWith(process.cwd())) {
		throw new Error('BORDR_DATA_DIR must be set to a temp dir before running state tests');
	}
	remote.target = 'fixture-a';
	remote.session = 'main';
	rmSync(join(DATA_DIR, 'read-state.json'), { force: true });
	rmSync(join(DATA_DIR, 'watch-done.json'), { force: true });
});

describe('read state', () => {
	it('records the highest seen seq per pane', () => {
		markRead('w1:p1', 5);
		markRead('w1:p1', 3); // stale write must not regress
		expect(readState()).toEqual({ 'w1:p1': 5 });
	});
});

it('does not acknowledge a replacement target or session with an old remote marker', () => {
	markRead('remote~w1:p1', 9);
	expect(readState()['remote~w1:p1']).toBe(9);
	remote.target = 'fixture-b';
	expect(seenStatus('done', 2, readState()['remote~w1:p1'])).toBe('done');
	markRead('remote~w1:p1', 2);
	expect(seenStatus('done', 2, readState()['remote~w1:p1'])).toBe('idle');
	remote.session = 'other';
	expect(readState()['remote~w1:p1']).toBeUndefined();
});

it('keeps legacy local reads but refuses unscoped remote reads and invalid sequences', () => {
	saveJson('read-state.json', { 'w1:p1': 5, 'remote~w1:p1': 9 });
	expect(readState()).toEqual({ 'w1:p1': 5 });
	for (const seq of [-1, NaN, Infinity, 1.5])
		expect(() => markRead('w1:p1', seq)).toThrow('invalid read marker');
});

describe('done watches', () => {
	it('is persistent: a watch survives being checked', () => {
		setWatched('w1:p1', true);
		expect(isWatched('w1:p1')).toBe(true);
		expect(isWatched('w1:p1')).toBe(true);
		expect(watchedPanes()).toEqual(['w1:p1']);
	});

	it('unwatching removes without consuming others', () => {
		setWatched('a', true);
		setWatched('b', true);
		setWatched('a', false);
		expect(watchedPanes()).toEqual(['b']);
	});
});

describe('seenStatus', () => {
	it('turns done to idle once read at or past the seq it finished on', () => {
		expect(seenStatus('done', 7, undefined)).toBe('done');
		expect(seenStatus('done', 7, 6)).toBe('done');
		expect(seenStatus('done', 7, 7)).toBe('idle');
		// Only done is acknowledged; a read never hides work or a question.
		expect(seenStatus('blocked', 7, 9)).toBe('blocked');
		expect(seenStatus('working', 7, 9)).toBe('working');
	});
});
