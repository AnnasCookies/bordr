import { describe, expect, it } from 'vitest';
import { formatPane, isRemote, parsePane } from './address';

describe('pane addresses', () => {
	it('leaves a local pane exactly as herdr names it', () => {
		// Every existing URL, read-state key and push entry depends on this.
		expect(parsePane('w3:p1')).toEqual({ machineId: '', paneId: 'w3:p1' });
		expect(formatPane('', 'w3:p1')).toBe('w3:p1');
		expect(isRemote('w3:p1')).toBe(false);
	});

	it('splits a remote pane on the first slash', () => {
		// herdr pane ids never contain a slash, so this cannot be ambiguous.
		expect(parsePane('tm-dev/w8:p1')).toEqual({ machineId: 'tm-dev', paneId: 'w8:p1' });
		expect(formatPane('tm-dev', 'w8:p1')).toBe('tm-dev/w8:p1');
		expect(isRemote('tm-dev/w8:p1')).toBe(true);
	});

	it('round-trips a machine id that looks like a pane id', () => {
		expect(parsePane(formatPane('w1:p1', 'w8:p1'))).toEqual({
			machineId: 'w1:p1',
			paneId: 'w8:p1'
		});
	});
});
