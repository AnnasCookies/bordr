import { describe, expect, it } from 'vitest';
import { ALLOW_FLAG, judgeBind, judgeHost, judgeUser, machinesInherit } from './bind';

describe('judgeBind', () => {
	it('allows loopback in every spelling', () => {
		for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]', '127.1.2.3']) {
			expect(judgeBind(host, undefined).ok, host).toBe(true);
		}
	});

	it('allows a Tailscale address, which is the intended deployment', () => {
		for (const host of ['100.64.0.1', '100.101.102.103', '100.127.255.254']) {
			expect(judgeBind(host, undefined).ok, host).toBe(true);
		}
	});

	/** The whole point: a paste of 0.0.0.0 must not quietly work. */
	it('refuses the addresses that expose an unauthenticated agent controller', () => {
		for (const host of ['0.0.0.0', '::', '192.168.1.10', '10.0.0.5', '203.0.113.7']) {
			const verdict = judgeBind(host, undefined);
			expect(verdict.ok, host).toBe(false);
			expect(verdict.reason, host).toContain('no authentication');
		}
	});

	it('is not fooled by addresses that merely start with 100', () => {
		expect(judgeBind('100.128.0.1', undefined).ok).toBe(false);
		expect(judgeBind('100.63.255.255', undefined).ok).toBe(false);
		expect(judgeBind('1000.64.0.1', undefined).ok).toBe(false);
	});

	/**
	 * The adapter's own default is 0.0.0.0, so an unset HOST is the exposed
	 * case wearing a blank expression. A previous version of this test asserted
	 * the opposite, on the belief that the default was loopback.
	 */
	it('refuses an unset or blank HOST, and says which line to add', () => {
		for (const host of [undefined, '', '   ']) {
			const verdict = judgeBind(host, undefined);
			expect(verdict.ok, String(host)).toBe(false);
			expect(verdict.reason, String(host)).toContain('HOST=127.0.0.1');
		}
	});

	it('yields only to the explicit opt-in, and names it in the refusal', () => {
		expect(judgeBind('0.0.0.0', '1').ok).toBe(true);
		expect(judgeBind('0.0.0.0', 'true').ok).toBe(false);
		expect(judgeBind('0.0.0.0', undefined).reason).toContain(ALLOW_FLAG);
		expect(judgeBind(undefined, '1').ok).toBe(true);
	});
});

describe('judgeHost', () => {
	const policy = { bindHost: '127.0.0.1', allowed: undefined, allowPublic: undefined };

	it('answers to loopback, tailnet addresses and MagicDNS names', () => {
		for (const name of [
			'127.0.0.1',
			'localhost',
			'[::1]',
			'100.101.102.103',
			'box.tail1234.ts.net'
		]) {
			expect(judgeHost(name, policy), name).toBe(true);
		}
	});

	/** DNS rebinding: the attacker's own name resolving to bordr's address. */
	it('refuses any other name, however it resolves', () => {
		for (const name of ['evil.example', 'box.tail1234.ts.net.evil.example', '192.168.1.10', '']) {
			expect(judgeHost(name, policy), name).toBe(false);
		}
	});

	it('answers to the bound HOST and to BORDR_ALLOWED_HOSTS, case-insensitively', () => {
		expect(judgeHost('192.168.1.10', { ...policy, bindHost: '192.168.1.10' })).toBe(true);
		expect(
			judgeHost('bordr.example.com', { ...policy, allowed: ' Bordr.Example.com, other.test ' })
		).toBe(true);
		expect(judgeHost('other.test', { ...policy, allowed: 'bordr.example.com,other.test' })).toBe(
			true
		);
		expect(judgeHost('third.test', { ...policy, allowed: 'bordr.example.com,other.test' })).toBe(
			false
		);
	});

	it('stands down entirely under the explicit opt-in', () => {
		expect(judgeHost('evil.example', { ...policy, allowPublic: '1' })).toBe(true);
	});
});

describe('judgeUser', () => {
	/** The default has to stay exactly as it was: a tailnet of one. */
	it('allows everything when no list is configured', () => {
		for (const allowed of [undefined, '', '   ', ',', ' , ']) {
			expect(judgeUser('alice@example.com', allowed), JSON.stringify(allowed)).toBe(true);
			expect(judgeUser(null, allowed), JSON.stringify(allowed)).toBe(true);
		}
	});

	it('allows a login on the list, however it is spelled or spaced', () => {
		const allowed = ' Alice@Example.com , bob@example.com ';
		for (const login of ['alice@example.com', 'ALICE@EXAMPLE.COM', ' alice@example.com ']) {
			expect(judgeUser(login, allowed), login).toBe(true);
		}
		expect(judgeUser('bob@example.com', allowed)).toBe(true);
	});

	it('refuses a login that is not on the list', () => {
		const allowed = 'alice@example.com';
		for (const login of ['mallory@example.com', 'alice@example.com.evil.test', 'alice']) {
			expect(judgeUser(login, allowed), login).toBe(false);
		}
	});

	/**
	 * The funnel case, and the reason this guard is worth having: funnel
	 * traffic carries no Tailscale identity header at all, so a configured
	 * list refuses it without the operator having to notice.
	 */
	it('refuses a request carrying no identity header once a list is set', () => {
		for (const login of [null, undefined, '', '   ']) {
			expect(judgeUser(login, 'alice@example.com'), JSON.stringify(login)).toBe(false);
		}
	});
});

describe('machinesInherit', () => {
	/**
	 * The whole argument. Naming a machine in herdr is a deliberate act at a
	 * terminal; when bordr is reachable by nobody that terminal is not, making
	 * it reachable from bordr grants nothing new, and a second list is
	 * bookkeeping that duplicates the first.
	 */
	it('inherits on a loopback bind', () => {
		expect(machinesInherit('127.0.0.1', undefined)).toBe(true);
		expect(machinesInherit('localhost', undefined)).toBe(true);
		expect(machinesInherit('::1', undefined)).toBe(true);
	});

	/** The tailnet is the boundary this whole app is built on. */
	it('inherits on a tailnet bind', () => {
		expect(machinesInherit('100.64.0.1', undefined)).toBe(true);
		expect(machinesInherit('100.127.255.254', undefined)).toBe(true);
	});

	/**
	 * The flag means somebody deliberately bound bordr somewhere else, so
	 * "everyone on this network" is now a wider set than "whoever is at this
	 * terminal" — which is exactly when the explicit list earns its keep.
	 */
	it('refuses to inherit once the no-auth flag is set', () => {
		expect(machinesInherit('127.0.0.1', '1')).toBe(false);
		expect(machinesInherit('100.64.0.1', '1')).toBe(false);
		expect(machinesInherit('0.0.0.0', '1')).toBe(false);
	});

	/**
	 * Unset HOST is the dangerous one: the adapter's own default is every
	 * interface. `judgeBind` refuses to serve at all, and this refuses to
	 * inherit, so neither depends on the other being right.
	 */
	it('never inherits without a bind it can vouch for', () => {
		expect(machinesInherit(undefined, undefined)).toBe(false);
		expect(machinesInherit('', undefined)).toBe(false);
		expect(machinesInherit('   ', undefined)).toBe(false);
		expect(machinesInherit('0.0.0.0', undefined)).toBe(false);
		expect(machinesInherit('192.168.1.10', undefined)).toBe(false);
		expect(machinesInherit('10.0.0.5', undefined)).toBe(false);
	});

	/** 100.x outside the CGNAT range is somebody's public address, not a tailnet. */
	it('is not fooled by an address that merely starts with 100', () => {
		expect(machinesInherit('100.63.0.1', undefined)).toBe(false);
		expect(machinesInherit('100.128.0.1', undefined)).toBe(false);
	});
});
