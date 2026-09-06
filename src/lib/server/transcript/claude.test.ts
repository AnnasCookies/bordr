import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAdapter } from './claude';
import { adapterFor } from './index';

const jsonl = readFileSync(new URL('./fixtures/claude-session.jsonl', import.meta.url), 'utf8');

describe('claudeAdapter.parse', () => {
	it('returns only user and assistant messages', () => {
		expect(claudeAdapter.parse(jsonl).map((m) => m.role)).toEqual([
			'user',
			'assistant',
			'assistant',
			'user',
			'system',
			'system'
		]);
	});

	it('parses string-form user messages — the dominant real-world shape', () => {
		const messages = claudeAdapter.parse(jsonl);
		const typed = messages.filter((m) => m.role === 'user').at(-1);
		expect(typed?.text).toBe('a typed message arrives as a plain string');
	});

	it('renders slash-command runs as system lines, not raw tags', () => {
		const messages = claudeAdapter.parse(jsonl);
		const system = messages.filter((m) => m.role === 'system');
		expect(system.map((m) => m.text)).toEqual(['→ /model', 'Set effort level to xhigh']);
		expect(JSON.stringify(messages)).not.toContain('<command-name>');
	});

	it('joins the text blocks of a message', () => {
		expect(claudeAdapter.parse(jsonl)[0].text).toBe('probe omp and pi');
	});

	it('collects tool calls separately from prose', () => {
		const assistant = claudeAdapter.parse(jsonl)[1];
		expect(assistant.text).toBe('Let me check.');
		expect(assistant.tools).toEqual([{ name: 'Bash', summary: 'Search omp binary' }]);
	});

	it('skips tool-result-only user entries instead of rendering empty bubbles', () => {
		const machinery =
			'{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x"}]}}\n';
		expect(claudeAdapter.parse(machinery + jsonl)).toHaveLength(6);
	});

	it('skips malformed lines rather than throwing', () => {
		const messages = claudeAdapter.parse('not json\n' + jsonl);
		expect(messages).toHaveLength(6);
	});

	it('skips a bare null or scalar line — valid JSON, but not a record', () => {
		expect(claudeAdapter.parse('null\n42\n"text"\n' + jsonl)).toHaveLength(6);
	});

	it('leaves sidechain (sub-agent) turns out of the conversation', () => {
		const sidechain = JSON.stringify({
			type: 'assistant',
			isSidechain: true,
			message: { content: [{ type: 'text', text: 'a subagent speaking' }] }
		});
		const text = JSON.stringify(claudeAdapter.parse(sidechain + '\n' + jsonl));
		expect(text).not.toContain('a subagent speaking');
	});
});

describe('claudeAdapter.resolve', () => {
	const home = mkdtempSync(join(tmpdir(), 'bordr-claude-'));
	const previous = process.env.CLAUDE_CONFIG_DIR;

	afterEach(() => {
		if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = previous;
	});
	afterAll(() => rmSync(home, { recursive: true, force: true }));

	it('honours CLAUDE_CONFIG_DIR when searching the project directories', async () => {
		const transcript = join(home, 'projects', '-home-dev-repo', 'abc.jsonl');
		mkdirSync(join(home, 'projects', '-home-dev-repo'), { recursive: true });
		writeFileSync(transcript, '');
		process.env.CLAUDE_CONFIG_DIR = home;
		expect(await claudeAdapter.resolve('abc')).toBe(transcript);
		expect(await claudeAdapter.resolve('missing')).toBeNull();
	});

	it('accepts an absolute transcript path as the other adapters do', async () => {
		const transcript = join(home, 'anywhere.jsonl');
		writeFileSync(transcript, '');
		expect(await claudeAdapter.resolve(transcript)).toBe(transcript);
		expect(await claudeAdapter.resolve(join(home, 'no-such.jsonl'))).toBeNull();
	});
});

describe('adapterFor', () => {
	it('resolves the claude adapter', () => {
		expect(adapterFor('claude')?.parse('')).toEqual(claudeAdapter.parse(''));
	});

	it('returns null for a harness with no adapter yet', () => {
		expect(adapterFor('gemini')).toBeNull();
	});
});

/**
 * Injected context Claude Code records as `user` entries. Shapes taken from
 * real transcripts: the skill body arrives as a block-form `text`, carries
 * `sourceToolUseID`, and is flagged `isMeta` — as is everything else the
 * harness injects. Nothing the human typed is ever flagged.
 */
const INJECTED = [
	JSON.stringify({
		type: 'user',
		isMeta: true,
		sourceToolUseID: 'toolu_01',
		message: {
			content: [
				{
					type: 'text',
					text: 'Base directory for this skill: /home/dev/.claude/skills/herdr\n\n# Herdr\n\nHerdr organizes terminals into workspaces.'
				}
			]
		}
	}),
	JSON.stringify({
		type: 'user',
		isMeta: true,
		message: { content: 'Continue from where you left off.' }
	}),
	JSON.stringify({
		type: 'user',
		isMeta: true,
		message: {
			content: [{ type: 'text', text: '[Image: original 1344x2992, displayed at 898x2000.]' }]
		}
	}),
	JSON.stringify({
		type: 'user',
		isMeta: true,
		message: { content: 'Another Claude session sent a message: <agent-message>hi</agent-message>' }
	}),
	// Unflagged in most versions — the tag, not isMeta, is what identifies it.
	JSON.stringify({
		type: 'user',
		message: {
			content:
				'Another Claude session sent a message:\n<teammate-message teammate_id="scout-b" color="green">\n{"result":"a two-kilobyte handover payload"}\n</teammate-message>'
		}
	}),
	JSON.stringify({
		type: 'user',
		message: {
			content:
				'<teammate-message teammate_id="team-lead" summary="Scout: UX audit">\n## Context\nlong brief\n</teammate-message>'
		}
	}),
	JSON.stringify({
		type: 'user',
		message: { content: '<task-notification> background review finished </task-notification>' }
	})
].join('\n');

describe('claudeAdapter.parse: injected context never wears the user bubble', () => {
	it('never renders an injected entry as a user message', () => {
		const messages = claudeAdapter.parse(INJECTED);
		expect(messages.filter((m) => m.role === 'user')).toEqual([]);
	});

	it('never pastes a skill body into the transcript', () => {
		const text = JSON.stringify(claudeAdapter.parse(INJECTED));
		expect(text).not.toContain('Herdr organizes terminals');
		expect(text).not.toContain('Base directory for this skill');
	});

	it('keeps a skill load visible as a named system line', () => {
		const messages = claudeAdapter.parse(INJECTED);
		expect(messages).toContainEqual({ role: 'system', text: '→ skill: herdr', tools: [] });
	});

	it('names a plugin-cached skill by its own directory, not the plugin version', () => {
		const line = JSON.stringify({
			type: 'user',
			isMeta: true,
			sourceToolUseID: 'toolu_02',
			message: {
				content: [
					{
						type: 'text',
						text: 'Base directory for this skill: /home/dev/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/brainstorming\n\n# Brainstorming'
					}
				]
			}
		});
		expect(claudeAdapter.parse(line)).toEqual([
			{ role: 'system', text: '→ skill: brainstorming', tools: [] }
		]);
	});

	it('attributes an inter-agent message to the agent, never to the user', () => {
		const messages = claudeAdapter.parse(INJECTED);
		expect(messages).toContainEqual({
			role: 'system',
			text: '→ message from scout-b',
			tools: []
		});
		expect(JSON.stringify(messages)).not.toContain('two-kilobyte handover payload');
	});

	it('uses a teammate summary as the line when one is given', () => {
		const messages = claudeAdapter.parse(INJECTED);
		expect(messages).toContainEqual({
			role: 'system',
			text: '→ team-lead: Scout: UX audit',
			tools: []
		});
	});

	it('shows a re-invoked skill too, in either wording the harness uses', () => {
		const lines = [
			JSON.stringify({
				type: 'user',
				isMeta: true,
				message: { content: '(Re-invocation of /council — the instructions were loaded earlier.)' }
			}),
			JSON.stringify({
				type: 'user',
				isMeta: true,
				message: { content: 'Skill /artifact-design was loaded earlier; this is a NEW invocation.' }
			})
		].join('\n');
		expect(claudeAdapter.parse(lines).map((m) => m.text)).toEqual([
			'→ skill: council',
			'→ skill: artifact-design'
		]);
	});

	it('reduces injected context to one line each, or nothing', () => {
		const messages = claudeAdapter.parse(INJECTED);
		expect(messages.map((m) => m.text)).toEqual([
			'→ skill: herdr',
			'→ message from scout-b',
			'→ team-lead: Scout: UX audit',
			'→ background task finished'
		]);
	});

	it('still renders genuinely typed messages, which are never flagged meta', () => {
		const typed = JSON.stringify({ type: 'user', message: { content: 'do the thing' } });
		expect(claudeAdapter.parse(INJECTED + '\n' + typed).at(-1)).toEqual({
			role: 'user',
			text: 'do the thing',
			tools: []
		});
	});
});

/**
 * Shapes measured in a real session on 2026-09-07: Claude Code writes all of
 * these into the `user` role with no meta flag, and a phone rendered each as
 * something the person had typed.
 */
describe('claude adapter: the harness talking to itself', () => {
	const user = (content: string) => JSON.stringify({ type: 'user', message: { content } });

	it('turns a background-task report into one line, however it is wrapped', () => {
		const bare = user(
			'<task-notification>\n<summary>Background security review found 2 issues</summary>\n<result>' +
				'x'.repeat(5000) +
				'</result>\n</task-notification>'
		);
		const preambled = user(
			'[SYSTEM NOTIFICATION - NOT USER INPUT]\nThis is an automated background-task event.\n\n' +
				'<task-notification>\n<summary>Agent "Repo hygiene scan" finished</summary>\n<result>' +
				'y'.repeat(5000) +
				'</result>\n</task-notification>'
		);
		expect(claudeAdapter.parse(bare + '\n' + preambled).map((m) => [m.role, m.text])).toEqual([
			['system', '→ background task: Background security review found 2 issues'],
			['system', '→ background task: Agent "Repo hygiene scan" finished']
		]);
	});

	it('turns the post-compaction summary into a marker instead of a 16 KB message', () => {
		const summary = user(
			'This session is being continued from a previous conversation that ran out of context. ' +
				'The summary below covers the earlier portion of the conversation.\n\n' +
				'z'.repeat(16000)
		);
		expect(claudeAdapter.parse(summary)).toEqual([
			{ role: 'system', text: '→ context compacted', tools: [] }
		]);
	});

	it('marks an interruption rather than quoting it', () => {
		expect(claudeAdapter.parse(user('[Request interrupted by user for tool use]'))).toEqual([
			{ role: 'system', text: '→ interrupted', tools: [] }
		]);
	});

	it("renders bordr's own photo prompt as a photo with its caption", () => {
		const one = user(
			'[The user attached an image from their phone: /home/dev/.local/state/bordr/uploads/1-a.png — ' +
				'use your file-reading tool to view it before responding.]\n\nlook at this'
		);
		const three = user(
			'[The user attached 3 images from their phone:\n- /a.png\n- /b.png\n- /c.png — ' +
				'use your file-reading tool to view them before responding.]'
		);
		// Applied by adapterFor for every harness, not by the Claude adapter itself.
		expect(
			adapterFor('claude')!
				.parse(one + '\n' + three)
				.map((m) => m.text)
		).toEqual(['📷 photo\nlook at this', '📷 3 photos']);
	});
});
