import { describe, expect, it } from 'vitest';
import { extractStatusLines } from './status';

const CLAUDE_SCREEN = `
some agent prose up here
──────────────────────────
  [Fable 5] | effort xhigh | Context 51% | 📁 bordr/main | Max 20x
  Session 69m | £1.98
  Current █░░░░░░░░ 12% (50m)
  Weekly  █░░░░░░░░ 12% (Fri 11:59pm)
  mcp connected | config in-sync · 5 parked
`;

const PI_SCREEN = `
Command completed successfully.
──────────────────────────
MODEL  gpt-5.6-sol | EFFORT medium | CTX 7% | DIR home/dev
OA PRO ░░░░░░░░░░ 5H:SPARK 0% (5h) | ██▊░░░░░░░ 7D 20%
CACHE  ██████▊░░░ 48% | 18.9k read
~
↑20k ↓32 R19k CH96.2% $0.113 (sub) 7.2%/272k (auto)  (openai-codex) gpt-5.6-sol • medium
`;

describe('extractStatusLines', () => {
	it('captures the whole contiguous status block, model line first', () => {
		const lines = extractStatusLines(CLAUDE_SCREEN);
		expect(lines[0]).toContain('[Fable 5]');
		expect(lines.at(-1)).toContain('mcp connected');
		expect(lines.length).toBe(5);
	});

	it('captures pi footers across the prompt-line gap', () => {
		const lines = extractStatusLines(PI_SCREEN);
		expect(lines[0]).toContain('MODEL  gpt-5.6-sol');
		expect(lines.at(-1)).toContain('↑20k');
		expect(lines).toHaveLength(4);
	});

	it('returns nothing for plain prose', () => {
		expect(extractStatusLines('just some text\nno status here at all')).toEqual([]);
	});

	it('condenses runs of spaces', () => {
		expect(extractStatusLines('A    | B  50%')[0]).toBe('A  | B  50%');
	});
});
