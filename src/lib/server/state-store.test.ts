import { beforeEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { isWatched, markRead, readState, setWatched, watchedPanes } from './state-store';

const DATA_DIR = process.env.BORDR_DATA_DIR;

beforeEach(() => {
	// Guard against regressing to the live directory: this suite deletes
	// what it points at, and the service's WorkingDirectory is the checkout.
	if (!DATA_DIR || DATA_DIR.startsWith(process.cwd())) {
		throw new Error('BORDR_DATA_DIR must be set to a temp dir before running state tests');
	}
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
