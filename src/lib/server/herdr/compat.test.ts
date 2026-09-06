import { describe, expect, it } from 'vitest';
import { judgeCompatibility, MAX_TESTED_PROTOCOL, MIN_PROTOCOL } from './compat';

describe('judgeCompatibility', () => {
	it('accepts the tested range', () => {
		expect(judgeCompatibility({ version: '0.8.2', protocol: MAX_TESTED_PROTOCOL }).level).toBe(
			'ok'
		);
		expect(judgeCompatibility({ version: '0.8.0', protocol: MIN_PROTOCOL }).level).toBe('ok');
	});

	it('warns rather than fails on a newer protocol', () => {
		const c = judgeCompatibility({ version: '0.9.0', protocol: MAX_TESTED_PROTOCOL + 1 });
		expect(c.level).toBe('untested');
		expect(c.message).toContain('tested to');
	});

	it('rejects an older protocol', () => {
		expect(judgeCompatibility({ version: '0.7.0', protocol: MIN_PROTOCOL - 1 }).level).toBe(
			'incompatible'
		);
	});

	it('rejects a herdr that reports no protocol at all', () => {
		expect(judgeCompatibility({ version: '0.8.2' }).level).toBe('incompatible');
	});
});
