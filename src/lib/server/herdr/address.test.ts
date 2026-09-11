import { describe, expect, it } from 'vitest';
import { formatPane, isRemote, parsePane } from './address';

describe('pane addresses', () => {
	it('leaves a local pane exactly as herdr names it', () => {
		// Every existing URL, read-state key and push entry depends on this.
		expect(parsePane('w3:p1')).toEqual({ machineId: '', paneId: 'w3:p1' });
		expect(formatPane('', 'w3:p1')).toBe('w3:p1');
		expect(isRemote('w3:p1')).toBe(false);
	});

	it('splits a remote pane on the first separator', () => {
		// `~` and not `/`: resolve() does not escape a slash, so a slash here
		// produced `/a/<machine>/<pane>` — two path segments and a 404 on tap.
		expect(parsePane('tm-dev~w8:p1')).toEqual({ machineId: 'tm-dev', paneId: 'w8:p1' });
		expect(formatPane('tm-dev', 'w8:p1')).toBe('tm-dev~w8:p1');
		expect(isRemote('tm-dev~w8:p1')).toBe(true);
	});

	it('separates with a character a URL path leaves alone', () => {
		// The colon is escaped by encodeURIComponent and always was — a local
		// `w3:p1` has one and its links work. What matters is that the
		// separator itself survives a path segment untouched, which `/` does
		// not: it becomes another segment and the route stops matching.
		const address = formatPane('tm-dev', 'w8:p1');
		expect(address).toContain('~');
		expect(encodeURIComponent('~')).toBe('~');
		expect(new URL(`http://x/a/${address}`).pathname.split('/')).toHaveLength(3);
	});

	it('round-trips a machine id that looks like a pane id', () => {
		expect(parsePane(formatPane('w1:p1', 'w8:p1'))).toEqual({
			machineId: 'w1:p1',
			paneId: 'w8:p1'
		});
	});
});
