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

const OMP_SCREEN = `
tool output above
╭── 󰪣 GPT-5.6-Sol    …bordr ────────󰕝───󰁨─────╮
╰─                                                   ─╯
 󰚩 CODEX PRO · OAuth subscription · 272.0K ctx · 128.0K out
  CTX   ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡄⠤⠤  68%  184.9K/272.0K · 87.1K left · 󰘚
wrapped text can start with anything
 󰔛 5H    ⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤   0%  resets 20:03 · 4h 59m
  7D    ⡇⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤   3%  resets Sat 09:10 · 6d 18h · 󰄬
another arbitrary continuation
 󰆼 CACHE ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇  97%  93.8M read · 0 write · 󰄬
and another one
 󰓅 RUN   󰋊 2.8M in · 󰁝 214.9K out · 󰈙 $52.943 · 󰔛 4h 48m ·  Bun
 1.4.2 · 󰧑 CTX C 11,804 · 󰄬 ITS ready
ctxc ✓ · 11 tools
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

	it('keeps every physical row in a wrapped OMP footer', () => {
		const lines = extractStatusLines(OMP_SCREEN, 12);
		expect(lines).toHaveLength(11);
		expect(lines[0]).toContain('CODEX PRO');
		expect(lines).toContain('wrapped text can start with anything');
		expect(lines).toContain('another arbitrary continuation');
		expect(lines).toContain('and another one');
		expect(lines).toContain('1.4.2 · 󰧑 CTX C 11,804 · 󰄬 ITS ready');
		expect(lines.at(-1)).toBe('ctxc ✓ · 11 tools');
		expect(lines.some((line) => line.includes('GPT-5.6-Sol'))).toBe(false);
	});

	it('returns nothing for plain prose', () => {
		expect(extractStatusLines('just some text\nno status here at all')).toEqual([]);
	});

	it('condenses runs of spaces', () => {
		expect(extractStatusLines('A    | B  50%')[0]).toBe('A  | B  50%');
	});
});

describe('extractStatusLines: an icon-and-middot statusline', () => {
	// A custom Claude Code statusline whose top row has no pipe, no percentage
	// and no bar glyph — just Nerd Font icons and `·` between fields. It was
	// dropped whole, so the model, directory, branch and commit all went
	// missing while the bars underneath came through.
	const ICON_ROW = ' Claude  bordr · 8 inline-worker ·  ~/bordr ·  main Δ7 · c495ee1b';

	it('keeps a row identified by its icons alone', () => {
		expect(extractStatusLines(`some prose\n${ICON_ROW}`)).toContain(ICON_ROW);
	});

	it('keeps it alongside the bar rows beneath it', () => {
		const screen = [ICON_ROW, ' CTX  ▰▰▰▱▱  80%  800K/1.0M', ' 5H  ▰▱▱▱▱  10%  resets 11:40'].join(
			'\n'
		);
		expect(extractStatusLines(screen)).toHaveLength(3);
	});

	it('still ignores prose, and a single stray glyph', () => {
		expect(extractStatusLines('just some text\nno status here at all')).toEqual([]);
		// One icon is not enough — tool output can carry one.
		expect(extractStatusLines('reading  the file now')).toEqual([]);
	});
});
