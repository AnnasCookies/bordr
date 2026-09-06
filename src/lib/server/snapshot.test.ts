import { describe, expect, it } from 'vitest';
import { cleanSnapshot } from './snapshot';

const SCREEN = `
Some agent output here.

──────────────────────────────────────────
╭──────────────────────────╮
│  boxed content stays out │
╰──────────────────────────╯

More output.


Even more.
MODEL  something | CTX 7% | DIR home
↑20k ↓32 CH96.2% $0.113 (sub)
`;

describe('cleanSnapshot', () => {
	it('drops horizontal rules and box chrome', () => {
		const cleaned = cleanSnapshot(SCREEN);
		expect(cleaned).not.toContain('─────');
		expect(cleaned).not.toContain('╭');
	});

	it('drops the status footer (it lives in the header)', () => {
		const cleaned = cleanSnapshot(SCREEN);
		expect(cleaned).not.toContain('MODEL');
		expect(cleaned).not.toContain('↑20k');
	});

	it('keeps the actual output and collapses blank runs', () => {
		const cleaned = cleanSnapshot(SCREEN);
		expect(cleaned).toContain('Some agent output here.');
		expect(cleaned).toContain('Even more.');
		expect(cleaned).not.toMatch(/\n\n\n/);
	});
});
