import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionDraftStore, type DraftStorage } from './session-draft';

class MemoryStorage implements DraftStorage {
	readonly values = new Map<string, string>();
	writes = 0;

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		this.writes += 1;
		this.values.set(key, value);
	}

	removeItem(key: string) {
		this.writes += 1;
		this.values.delete(key);
	}
}

describe('session draft store', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('debounces typing and restores each pane separately', () => {
		const storage = new MemoryStorage();
		const drafts = createSessionDraftStore(storage, 300);

		expect(drafts.load('one')).toBe('');
		drafts.schedule('one', 'hel');
		vi.advanceTimersByTime(200);
		drafts.schedule('one', 'hello');
		vi.advanceTimersByTime(299);
		expect(storage.values.get('bordr-draft:one')).toBeUndefined();
		expect(storage.writes).toBe(0);

		vi.advanceTimersByTime(1);
		expect(storage.values.get('bordr-draft:one')).toBe('hello');
		expect(storage.writes).toBe(1);

		storage.values.set('bordr-draft:two', 'other pane');
		expect(drafts.load('two')).toBe('other pane');
	});

	it('does not reset or repeat a pending save when polling returns the same draft', () => {
		const storage = new MemoryStorage();
		const drafts = createSessionDraftStore(storage, 300);

		drafts.load('one');
		drafts.schedule('one', 'unchanged');
		vi.advanceTimersByTime(200);
		drafts.schedule('one', 'unchanged');
		vi.advanceTimersByTime(100);
		expect(storage.values.get('bordr-draft:one')).toBe('unchanged');
		expect(storage.writes).toBe(1);

		drafts.schedule('one', 'unchanged');
		vi.advanceTimersByTime(300);
		expect(storage.writes).toBe(1);
	});

	it('flushes recent text on leave and clears sent text without a stale rewrite', () => {
		const storage = new MemoryStorage();
		const drafts = createSessionDraftStore(storage, 300);

		drafts.load('one');
		drafts.schedule('one', 'not old enough for the timer');
		drafts.flush();
		expect(storage.values.get('bordr-draft:one')).toBe('not old enough for the timer');

		drafts.schedule('one', 'sent');
		drafts.clear('one');
		vi.advanceTimersByTime(300);
		expect(storage.values.get('bordr-draft:one')).toBeUndefined();
	});
	it('restores a failed send to its own pane', () => {
		const storage = new MemoryStorage();
		const drafts = createSessionDraftStore(storage, 300);

		drafts.load('one');
		drafts.schedule('one', 'newer text');
		expect(drafts.restore('one', 'failed send')).toBe('failed send\nnewer text');

		storage.values.set('bordr-draft:two', 'other draft');
		expect(drafts.restore('two', 'failed elsewhere')).toBe('failed elsewhere\nother draft');
		expect(storage.values.get('bordr-draft:one')).toBe('failed send\nnewer text');
		expect(storage.values.get('bordr-draft:two')).toBe('failed elsewhere\nother draft');
	});

	it('keeps the composer usable when browser storage is unavailable', () => {
		const broken: DraftStorage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		const drafts = createSessionDraftStore(broken, 300);

		expect(drafts.load('one')).toBe('');
		expect(() => {
			drafts.schedule('one', 'still usable');
			vi.advanceTimersByTime(300);
			drafts.clear('one');
		}).not.toThrow();
	});
});
