import { describe, expect, it } from 'vitest';
import { asyncQuestionKey, keysForOption, menuFooter, parsePicker, suggestionFrom } from './picker';

const ASK_USER_QUESTION = `
❯ Use the AskUserQuestion tool to ask me to pick a colour.

Pick a colour:

❯ 1. Red
     Red
  2. Green
     Green
  3. Blue
     Blue
  4. Type something.

  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`;

const TRUST_PROMPT = `
 Quick safety check: Is this a project you created or one you trust?

 ❯ 1. Yes, I trust this folder
   2. No, exit

 Enter to confirm · Esc to cancel
`;

const MODEL_MENU = `
   Select model
   Switch between Claude models. Your pick becomes the default for new sessions.
     1. Default (recommended)  Opus 5 with 1M context · Best for everyday, complex tasks
     2. Opus (1M context)      Opus 5 with 1M context · Best for everyday, complex tasks
     3. Fable                  Fable 5 · Most capable for your hardest tasks
   ❯ 4. Sonnet ✔               Sonnet 5 · Efficient for routine tasks
     5. Haiku                  Haiku 4.5 · Fastest for quick answers
   Enter to set as default · s to use this session only · Esc to cancel
`;

const CODEX_TRUST = `
> You are in /tmp
  Do you trust the contents of this directory?
› 1. Yes, continue
  2. No, quit
  Press enter to continue
`;

const AGY_PICKER = `
Rich notifications — better than the test message?
> 1. Much better
  2. Send it plainer
  3. Write-in...
  ↑/↓ Navigate · enter Select · esc Skip
`;

const MULTI_SELECT = `
Pick sounds:

❯ 1. [x] Buzz
  2. [ ] Ding
  3. [✔] Silence
  Submit
Enter to submit answer · Esc to cancel
`;

// Verbatim shape from a live grok dialog: rows sit inside a box border.
const GROK_DIALOG = `
  ┃  Your free usage is up.
  ┃  1 (○) Upgrade to SuperGrok        For everyday coding and productivity tasks
  ┃  2 (●) Upgrade to SuperGrok Plus   Significantly higher usage and rate limits
  ┃  3 (○) Upgrade to SuperGrok Heavy  Get the most out of Grok Build.
  ┃  ↑/↓ navigate · y copy                                          Enter:submit
`;

// A numbered plan in the agent's prose sits above a real permission prompt.
const PROSE_THEN_PICKER = `
Here is the plan:
1. First
2. Second
3. Third

Allow Bash to run rm -rf build?

❯ 1. Yes
  2. No

Enter to confirm · Esc to cancel
`;

describe('parsePicker', () => {
	it('takes the list nearest the footer when prose above is also numbered', () => {
		const picker = parsePicker(PROSE_THEN_PICKER);
		expect(picker?.options.map((o) => o.label)).toEqual(['Yes', 'No']);
		expect(picker?.options.find((o) => o.selected)?.index).toBe(1);
		expect(picker?.question).toBe('Allow Bash to run rm -rf build?');
	});

	it('parses grok dialogs — radio markers, no dot, Enter:submit footer', () => {
		const picker = parsePicker(GROK_DIALOG);
		expect(picker?.options.map((o) => o.index)).toEqual([1, 2, 3]);
		expect(picker?.options[0].label).toContain('Upgrade to SuperGrok');
		// The filled radio is the selection, not a caret.
		expect(picker?.options.find((o) => o.selected)?.index).toBe(2);
	});

	it('parses agy pickers — plain > marker, Navigate/Skip footer', () => {
		const picker = parsePicker(AGY_PICKER);
		expect(picker?.options.map((o) => o.label)).toEqual([
			'Much better',
			'Send it plainer',
			'Write-in...'
		]);
		expect(picker?.options[0].selected).toBe(true);
		expect(picker?.multi).toBe(false);
	});

	it('parses multi-select checkboxes and flags the picker as multi', () => {
		const picker = parsePicker(MULTI_SELECT);
		expect(picker?.multi).toBe(true);
		expect(picker?.options.map((o) => [o.label, o.checked])).toEqual([
			['Buzz', true],
			['Ding', false],
			['Silence', true] // Claude's heavy checkmark
		]);
	});

	it('parses codex pickers — › marker, press-enter footer', () => {
		const picker = parsePicker(CODEX_TRUST);
		expect(picker?.options.map((o) => o.label)).toEqual(['Yes, continue', 'No, quit']);
		expect(picker?.options[0].selected).toBe(true);
	});

	it('parses a slash-command selector (its footer has no "Enter to select")', () => {
		const picker = parsePicker(MODEL_MENU);
		expect(picker?.options).toHaveLength(5);
		expect(picker?.options.find((o) => o.selected)?.index).toBe(4);
	});

	it('parses every option including the ones Claude Code appends', () => {
		const picker = parsePicker(ASK_USER_QUESTION);
		expect(picker?.options.map((o) => o.label)).toEqual([
			'Red',
			'Green',
			'Blue',
			'Type something.',
			'Chat about this'
		]);
	});

	it('marks the rows that take typed text rather than answering', () => {
		const writeIns = (screen: string) =>
			parsePicker(screen)
				?.options.filter((o) => o.writeIn)
				.map((o) => o.label);
		expect(writeIns(ASK_USER_QUESTION)).toEqual(['Type something.']);
		expect(writeIns(AGY_PICKER)).toEqual(['Write-in...']);
		expect(writeIns(MULTI_SELECT)).toEqual([]);
	});

	it('marks the highlighted option', () => {
		const picker = parsePicker(ASK_USER_QUESTION);
		expect(picker?.options.find((o) => o.selected)?.index).toBe(1);
	});

	it('does not mistake the input prompt caret for an option', () => {
		const picker = parsePicker(ASK_USER_QUESTION);
		expect(picker?.options).toHaveLength(5);
	});

	it('extracts the question', () => {
		expect(parsePicker(ASK_USER_QUESTION)?.question).toBe('Pick a colour:');
	});

	it('parses the startup trust prompt with the same parser', () => {
		const picker = parsePicker(TRUST_PROMPT);
		expect(picker?.options.map((o) => o.label)).toEqual(['Yes, I trust this folder', 'No, exit']);
		expect(picker?.options[0].selected).toBe(true);
	});

	it('returns null when there is no picker on screen', () => {
		expect(parsePicker('just some ordinary output\nnothing to pick here')).toBeNull();
	});

	it('does not mistake an ordinary numbered list for a picker', () => {
		expect(
			parsePicker('Here is my plan:\n1. First step\n2. Second step\n3. Third step')
		).toBeNull();
	});
});

/** Claude Code's folder trust prompt as read live on 2026-09-07: no numbers at all. */
const CLAUDE_TRUST_UNNUMBERED = `
❯ claude
──────────────────────────────
 Accessing workspace:
 /home/dev/project
 Quick safety check: Is this a project you created or one you trust? (Like your own code.)
 Claude Code'll be able to read, edit, and execute files here.
 Security guide
 ❯ No, exit
   Yes, I trust this folder
 Enter to confirm · Esc to cancel
`;

describe('parsePicker: unnumbered caret lists', () => {
	it('parses the trust prompt, flags it unnumbered, and finds the question past the link line', () => {
		const picker = parsePicker(CLAUDE_TRUST_UNNUMBERED);
		expect(picker?.numbered).toBe(false);
		expect(picker?.options.map((o) => [o.index, o.label, o.selected])).toEqual([
			[1, 'No, exit', true],
			[2, 'Yes, I trust this folder', false]
		]);
		expect(picker?.question).toContain('Quick safety check');
	});

	it('does not mistake an ordinary indented block above a footer for options', () => {
		const prose = `
 Some notes:
   first point
   second point
 Enter to confirm · Esc to cancel
`;
		expect(parsePicker(prose)).toBeNull();
	});

	it('answers an unnumbered list with arrows and Enter, never a digit', () => {
		expect(keysForOption(2, 1, false)).toEqual(['down', 'enter']);
		expect(keysForOption(1, 2, false)).toEqual(['up', 'enter']);
		expect(keysForOption(2, 1, true)).toEqual(['2']);
	});
});

/** pi's /model selector as read live on 2026-09-07: arrow highlight, ✓ on the current model, a page counter before the footer. */
const PI_MODEL_SELECTOR = `
Only showing models from configured providers. Use /login to add providers.
>
→ ✓ gpt-5.6-sol [openai-codex] · default
    claude-fable-5 [anthropic]
    claude-fable-5-1 [anthropic]
    claude-haiku-4-5 [anthropic]
  (1/25)
  Model Name: GPT-5.6 Sol
  Model catalogs refreshed.
  Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel
`;

describe('parsePicker: pi model selector', () => {
	it('parses the arrow-highlighted list with the counter and status lines in between', () => {
		const picker = parsePicker(PI_MODEL_SELECTOR);
		expect(picker?.numbered).toBe(false);
		expect(picker?.options.map((o) => [o.label, o.selected])).toEqual([
			['gpt-5.6-sol [openai-codex] · default', true],
			['claude-fable-5 [anthropic]', false],
			['claude-fable-5-1 [anthropic]', false],
			['claude-haiku-4-5 [anthropic]', false]
		]);
	});
});

/** omp's ask dialog as read live on 2026-09-07: boxed, hollow radios, caret highlight, terse footer. */
const OMP_ASK = `
╭─── Ask 1 questions ───────────────────────
├─── [colour] · options:3 ──────────────────
│  Which colour?
│  ○ Red
│  ○ Green
│  ○ Blue
╰──────────────────────────────────────────
  ⎋ Asking colour choice
╭─ Ask ─────────────────────────────────────
│ Which colour?
├──────────────────────────────────────────
│ ❯ ○ Red                                  │
│   ○ Green                                │
│   ○ Blue                                 │
│   ○ Other (type your own)                │
│                                          │
├──────────────────────────────────────────
│ Enter select · n note · ↑/↓ move · Esc cancel
╰──────────────────────────────────────────
`;

/** Current nerd-symbol preset from the live OMP ask that failed in Bordr. */
const OMP_ASK_NERD = `
╭─ Ask ─────────────────────────────────────
│ Pick a colour.                            │
├───────────────────────────────────────────┤
│   Red                                  │
│    Green                                │
│    Blue                                 │
│    Other (type your own)                │
├───────────────────────────────────────────┤
│ Enter select · n note · ↑/↓ move · Esc cancel
╰───────────────────────────────────────────╯
`;

describe('parsePicker: omp ask dialog', () => {
	it('parses the boxed radio list nearest the footer, not the summary box above it', () => {
		const picker = parsePicker(OMP_ASK);
		expect(picker?.numbered).toBe(false);
		expect(picker?.options.map((o) => [o.label, o.selected])).toEqual([
			['Red', true],
			['Green', false],
			['Blue', false],
			['Other (type your own)', false]
		]);
		expect(picker?.question).toBe('Which colour?');
	});

	it('parses the live nerd-symbol radio list', () => {
		const picker = parsePicker(OMP_ASK_NERD);
		expect(picker?.numbered).toBe(false);
		expect(picker?.options.map((o) => [o.label, o.selected])).toEqual([
			['Red', true],
			['Green', false],
			['Blue', false],
			['Other (type your own)', false]
		]);
		expect(picker?.question).toBe('Pick a colour.');
	});
});

describe('parsePicker: grok rows padded with a scrollbar', () => {
	it('drops the scrollbar cell and the doubled description', () => {
		const screen = [
			'  ┃  Which colour?',
			'  ┃  1 (●) Red    Red                                          █',
			'  ┃  2 (○) Green  Green                                        █',
			'  ┃  3 (○) Blue   Blue',
			'  ┃  ↑/↓ navigate · y copy                        Enter:submit'
		].join('\n');
		expect(parsePicker(screen)?.options.map((o) => o.label)).toEqual(['Red', 'Green', 'Blue']);
	});
});

/** agy's /model menu as read live on 2026-09-07: bare > caret, an effort slider among the rows, mixed-case footer. */
const AGY_MODEL_MENU = `
>
────────────────────────────────
Switch Model
> Gemini 3.8 Flash             (current)
  Gemini 3.7 Flash
  Claude Opus 4.6 (Thinking)
  Effort  ◂        ●━━━━━━━━━━━━━━●━━━━━━━━━━━━━━◉        ▸
                  low          medium          high
            Deepest reasoning for complex problems — slower but strongest
Keyboard: ↑/↓ Navigate  ←/→ Effort  enter Select  esc Go Back
`;

describe('parsePicker: agy model menu', () => {
	it('parses the models and leaves the effort slider out', () => {
		const picker = parsePicker(AGY_MODEL_MENU);
		expect(picker?.options.map((o) => [o.label, o.selected])).toEqual([
			['Gemini 3.8 Flash             (current)', true],
			['Gemini 3.7 Flash', false],
			['Claude Opus 4.6 (Thinking)', false]
		]);
		expect(picker?.question).toBe('Switch Model');
	});
});

/** copilot's /model as read live on 2026-09-07: the highlighted row sits above a search box that also carries a caret. */
const COPILOT_MODEL_MENU = `
 Your Copilot Free plan currently includes only Auto.
   Recommended models
 ❯ Auto ✓
   Unavailable models
   gpt-5.6-sol
   claude-opus-5
 ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
  ❯  Search models…
 ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
 ↑/↓ to navigate · shift+tab group: recommended · enter to select · esc to cancel
`;

describe('parsePicker: copilot model menu', () => {
	it('anchors on the highlighted row, not the search box nearer the footer', () => {
		const picker = parsePicker(COPILOT_MODEL_MENU);
		expect(picker?.options.find((o) => o.selected)?.label).toBe('Auto ✓');
		expect(picker?.options.map((o) => o.label)).toContain('claude-opus-5');
	});
});

/** Claude Code 2.1.263's /effort dialog as read live on 2026-09-07 (columns preserved). */
const CLAUDE_EFFORT = [
	'❯ /effort',
	'  ⎿  Cancelled',
	'▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔',
	'   Effort',
	'                                                                                                 Faster                                                 Smarter',
	'                                                                                                 ──────────────────────────────▲────────────┆──────────────────',
	'                                                                                                 low     medium     high     xhigh      max       ultracode',
	'                                                                                                                                              xhigh + workflows',
	'   ←/→ to adjust · Enter to confirm · s for this session only · Esc to cancel'
].join('\n');

describe('parsePicker: Claude Code effort slider', () => {
	it('turns the stops into options with the marked one current, answered sideways', () => {
		const picker = parsePicker(CLAUDE_EFFORT);
		expect(picker?.axis).toBe('horizontal');
		expect(picker?.numbered).toBe(false);
		expect(picker?.question).toBe('Effort');
		expect(picker?.options.map((o) => [o.label, o.selected])).toEqual([
			['low', false],
			['medium', false],
			['high', false],
			['xhigh', true],
			['max', false],
			['ultracode', false]
		]);
		expect(keysForOption(2, 4, false, 'horizontal')).toEqual(['left', 'left', 'enter']);
		expect(keysForOption(6, 4, false, 'horizontal')).toEqual(['right', 'right', 'enter']);
	});
});

/** agy while it generates, as read live on 2026-09-07: the echoed prompt wraps under a `>` and the footer is a bare "esc to cancel". */
const AGY_GENERATING = [
	'────────────────────────────────────────────────────────────',
	"> Reply with the single line PROBE OK. Then list the files in the current directory using a tool. Then, if you have a tool for asking the user a question with options, ask me 'Which colour?' with options Red, Green, Blue and wait for my answer. If you",
	'  have no such tool, reply with the single line NO ASK TOOL.',
	'⣷  Generating...',
	'──────────────────────────────────────────────────────────────────────────',
	'>',
	'──────────────────────────────────────────────────────────────────────────',
	'esc to cancel                                              accept-edits · Gemini 3.8 Flash · high'
].join('\n');

/** The same echo with agy's slash-command completer open beneath it, whose footer does say how to choose. */
const AGY_ECHO_UNDER_COMPLETER = [
	'────────────────────────────────────────────────────────────',
	"> Reply with the single line PROBE OK. Then list the files in the current directory using a tool. Then, if you have a tool for asking the user a question with options, ask me 'Which colour?' with options Red, Green, Blue and wait for my answer. If you",
	'  have no such tool, reply with the single line NO ASK TOOL.',
	'──────────────────────────────────────────────────────────────────────────',
	'> /model  Set a model, or run a single prompt on another model',
	'  ↑/↓ Navigate · enter Select · tab Complete',
	'esc to cancel                                              accept-edits · Gemini 3.8 Flash · high'
].join('\n');

describe('parsePicker: agy echoing a wrapped prompt', () => {
	it('is not a dialog while it generates: the footer says only how to cancel', () => {
		expect(parsePicker(AGY_GENERATING)).toBeNull();
	});
	it('is not a dialog under the completer either: no option runs the width of the terminal', () => {
		expect(parsePicker(AGY_ECHO_UNDER_COMPLETER)).toBeNull();
	});
});

/** agy's model menu under a reply that itself was a numbered list, as read live on 2026-09-07. */
const AGY_MENU_UNDER_NUMBERED_PROSE = [
	'  Done. Everything is complete:',
	'  1. Merged to main: Commit 51eab5d is live on origin/main.',
	'  2. Main checkout updated: Pulled into /home/dev/dotagents.',
	'  3. Cleaned up: the feature branch is gone.',
	'  4. Verified locally: the render is byte-identical.',
	'  ──────',
	'  ### 2. Likely Variety / Cultivar',
	'  It is a classic round field pumpkin. Narrowing down the exact cultivar depends on its',
	'  physical diameter against the wire mesh:',
	'  • If medium-to-large (approx. 20–30 cm), a carving pumpkin.',
	'  • If smaller, a pie pumpkin.',
	'> /model',
	'  ⎿  Exited /model command',
	'───────────────────────────────────────────────────────────',
	'>',
	'───────────────────────────────────────────────────────────',
	'Switch Model',
	'> Gemini 3.8 Flash             (current)',
	'  Gemini 3.7 Flash',
	'  Gemini 3.6 Flash',
	'  Gemini 3.1 Pro',
	'  Claude Sonnet 4.6 (Thinking)',
	'  Claude Opus 4.6 (Thinking)',
	'  GPT-OSS 120B (Medium)',
	'  Effort  ◂        ●━━━━━━━━━━━━━━●━━━━━━━━━━━━━━◉        ▸',
	'                  low          medium          high',
	'            Deepest reasoning for complex problems — slower but strongest',
	'Keyboard: ↑/↓ Navigate  ←/→ Effort  enter Select  esc Go Back'
].join('\n');

describe('parsePicker: a numbered list in prose above an unnumbered menu', () => {
	it('takes the menu beside the footer, not the sentences far above it', () => {
		const picker = parsePicker(AGY_MENU_UNDER_NUMBERED_PROSE);
		expect(picker?.numbered).toBe(false);
		expect(picker?.question).toBe('Switch Model');
		expect(picker?.options.map((o) => o.label)).toEqual([
			'Gemini 3.8 Flash             (current)',
			'Gemini 3.7 Flash',
			'Gemini 3.6 Flash',
			'Gemini 3.1 Pro',
			'Claude Sonnet 4.6 (Thinking)',
			'Claude Opus 4.6 (Thinking)',
			'GPT-OSS 120B (Medium)'
		]);
		expect(picker?.options.find((o) => o.selected)?.label).toContain('Gemini 3.8 Flash');
	});
});

describe('menuFooter: a panel or menu with no readable options', () => {
	it("names omp's model browser and Claude Code's /config by their footers", () => {
		expect(
			menuFooter(
				'│   anthropic/claude-opus-5\n│ ↑/↓ models · Enter use for this session · type to search · Esc close\n╰────'
			)
		).toBe('↑/↓ models · Enter use for this session · type to search · Esc close');
		expect(
			menuFooter(
				'     Theme            Dark mode\n   Enter/Space to change · / to search · Esc to close'
			)
		).toBe('Enter/Space to change · / to search · Esc to close');
	});

	it("recognises OMP's model browser when a narrow pane clips the Esc hint", () => {
		expect(
			menuFooter(
				'│    deepseek               │    default ·  slow │\n' +
					'│ Enter assign roles · ↑/↓ providers · → models · type to sear… │\n' +
					'╰───────────────────────────────────────────────────────────────╯'
			)
		).toBe('Enter assign roles · ↑/↓ providers · → models · type to sear…');
	});

	it("recognises OMP's settings panel when a narrow pane clips the Esc hint", () => {
		expect(
			menuFooter(
				'│   Theme                                                     █ │\n' +
					'│  Dark Theme                  titanium                      █ │\n' +
					'│ Enter/Space to change · Tab to jump sections · ←/→ to switch… │\n' +
					'╰───────────────────────────────────────────────────────────────╯'
			)
		).toBe('Enter/Space to change · Tab to jump sections · ←/→ to switch…');
	});

	it('finds nothing on an idle screen of any harness', () => {
		for (const idle of [
			'❯\n────\n  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
			'CACHE  idle\n~/Documents/Dev/GitHub/sera (main)\n🔌 MCP: 4 servers enabled',
			'MODEL  claude-opus-5 | EFFORT xhigh | CTX 13%',
			'› Ask Codex to do anything\n  gpt-6-astra max · ~/.codex · Main [default]',
			'>\n────\n? for shortcuts                       accept-edits · Gemini 3.8 Flash · high',
			'Enter:send  │  Shift+Tab:mode  │  Ctrl+.:shortcuts'
		]) {
			expect(menuFooter(idle)).toBeNull();
		}
	});
});

describe('suggestionFrom', () => {
	// Captured live from herdr `pane read --format ansi` across eleven panes.
	const E = '\u001b';
	const SUGGESTION = `\u276f ${E}[0m${E}[2myeah commit and push both${E}[0m\r`;
	const TYPED =
		`${E}[0m${E}[38;2;80;80;80m${E}[48;2;55;55;55m\u276f ${E}[0m` +
		`${E}[38;2;255;255;255m${E}[48;2;55;55;55mcan we make it even better${E}[0m`;
	const EMPTY = '\u276f \r';

	it('reads the dim ghost prompt out of the input row', () => {
		expect(suggestionFrom(SUGGESTION)).toBe('yeah commit and push both');
	});

	it('never mistakes text you actually typed for a suggestion', () => {
		// The difference is a background: typed characters are in the buffer.
		expect(suggestionFrom(TYPED)).toBeNull();
	});

	it('returns null for an empty box and for a screen with no input row', () => {
		expect(suggestionFrom(EMPTY)).toBeNull();
		expect(suggestionFrom('just some output\nand more')).toBeNull();
	});

	it('fails closed when the styling changes', () => {
		// A restyled hint yields no suggestion rather than a wrong one.
		expect(suggestionFrom(`\u276f ${E}[38;5;240msome new styling${E}[0m`)).toBeNull();
	});

	/**
	 * Claude Code's multi-question form, on its review stage. Captured off a
	 * real pane while the form was up: no footer anywhere on the screen, and
	 * the whole form was unanswerable from a phone because of it.
	 */
	it('reads a caret-marked list with no footer at all', () => {
		const screen =
			'\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\u2190  \u2612 Polish  \u2612 Severity  \u2714 Submit  \u2192\n\nReview your answers\n\n \u25cf Reproducing the submit bug \u2014 which polish first?\n   \u2192 Terminal mode\n \u25cf And how blocking is the submit problem?\n   \u2192 Fix it first\n\nReady to submit your answers?\n\n\u276f 1. Submit answers\n  2. Cancel';
		const picker = parsePicker(screen);
		expect(picker).not.toBeNull();
		expect(picker?.options.map((o) => o.label)).toEqual(['Submit answers', 'Cancel']);
		expect(picker?.options[0].selected).toBe(true);
		expect(picker?.question).toBe('Ready to submit your answers?');
	});
});

describe('parsePicker: what the approval is about', () => {
	/** Claude Code's permission dialog, as it actually draws. */
	const PERMISSION = [
		'╭──────────────────────────────────────────────╮',
		'│ Bash command                                 │',
		'│                                              │',
		'│   rm -rf /tmp/build-cache                    │',
		'│   Clear the stale build cache                │',
		'│                                              │',
		'│ Do you want to proceed?                      │',
		'│ ❯ 1. Yes                                     │',
		"│   2. Yes, and don't ask again this session   │",
		'│   3. No, and tell Claude what to do          │',
		'╰──────────────────────────────────────────────╯'
	].join('\n');

	it('keeps the command being approved, not just the question', () => {
		// The complaint this fixes: a bare "Do you want to proceed?" with yes/no
		// and no sign of WHAT — unanswerable on a phone.
		const picker = parsePicker(PERMISSION)!;
		expect(picker.question).toBe('Do you want to proceed?');
		expect(picker.context).toContain('rm -rf /tmp/build-cache');
		expect(picker.context).toContain('Bash command');
	});

	it('strips the box, and stops at its top rule', () => {
		const picker = parsePicker(`earlier transcript line\n${PERMISSION}`)!;
		expect(picker.context.join('\n')).not.toContain('│');
		expect(picker.context.join('\n')).not.toContain('earlier transcript line');
	});

	it('still reads the options', () => {
		const picker = parsePicker(PERMISSION)!;
		expect(picker.options.map((o) => o.index)).toEqual([1, 2, 3]);
		expect(picker.options[0].selected).toBe(true);
	});

	it('is empty when there is nothing above the question', () => {
		const bare = ['Pick one', '❯ 1. Red', '  2. Blue'].join('\n');
		const picker = parsePicker(bare)!;
		expect(picker.context).toEqual([]);
	});
});

/**
 * codex 0.155's `request_user_input_async`: the question waits collapsed above
 * the composer until its key opens it. Shapes from codex's own render
 * snapshots (tui/src/bottom_pane), with the Linux key names it prints.
 */
const CODEX_COLLAPSED = [
	'• Explored the deploy config.',
	'',
	'  ? 1 question · 45s',
	'    alt + ↑ to answer',
	'',
	'› Ask Codex to do anything',
	'',
	'  gpt-6-astra max fast · 62% left · ~/Documents/Dev/GitHub/sera'
].join('\n');
const CODEX_OPENED = [
	'  Where will you test Sera? If you use an existing site, include its URL',
	'  so I can verify the build you’ll actually see.',
	'',
	'  › 1. Existing staging site',
	'    2. Local preview',
	'    3. Other (write an answer)',
	'',
	'  enter submit   ctrl + ] skip',
	'  alt + ↓ main prompt'
].join('\n');

describe('codex async questions', () => {
	it('finds the key that opens a collapsed question, in either key spelling', () => {
		expect(asyncQuestionKey(CODEX_COLLAPSED)).toBe('alt+up');
		expect(asyncQuestionKey(CODEX_COLLAPSED.replace('alt + ↑', '⌥ + ↑'))).toBe('alt+up');
		expect(asyncQuestionKey(CODEX_COLLAPSED.replace('alt + ↑', 'shift + ←'))).toBe('shift+left');
		expect(asyncQuestionKey(CODEX_COLLAPSED.replace('? 1 question', '? 2 questions'))).toBe(
			'alt+up'
		);
	});

	it('does not open anything without the collapsed summary, or with a key it cannot send', () => {
		expect(asyncQuestionKey('› Ask Codex to do anything')).toBeNull();
		// A remapped binding is codex's own business; guessing would type into it.
		expect(asyncQuestionKey(CODEX_COLLAPSED.replace('alt + ↑', 'ctrl + o'))).toBeNull();
		// The hint belongs to the summary line above it, not to prose elsewhere.
		expect(asyncQuestionKey('Reply to answer\n    alt + ↑ to answer')).toBeNull();
	});

	it('reads the opened question as a numbered, keyed picker', () => {
		const picker = parsePicker(CODEX_OPENED)!;
		expect(picker.options.map((o) => o.label)).toEqual([
			'Existing staging site',
			'Local preview',
			'Other (write an answer)'
		]);
		expect(picker.numbered).toBe(true);
		expect(picker.answer).toBeUndefined();
	});
});
