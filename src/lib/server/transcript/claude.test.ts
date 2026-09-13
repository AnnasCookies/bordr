import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { askFromQuestions, claudeAdapter, toolLabel, toolSummary } from './claude';
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

	/**
	 * The other half of the rule below, and the one that was missing.
	 *
	 * A sub-agent's own transcript carries the flag on EVERY entry, so the skip
	 * that correctly keeps sidechains out of a session threw away the whole
	 * file: opening a sub-agent showed an empty sheet, every time. Measured on
	 * a real one — 67 turns, all of them dropped.
	 */
	it("keeps every turn when the file IS the sub-agent's transcript", () => {
		const turn = (role: string, text: string) =>
			JSON.stringify({
				type: role,
				isSidechain: true,
				timestamp: '2026-01-01T00:00:00.000Z',
				message: { content: text }
			});
		const text = [turn('user', 'go and look'), turn('assistant', 'found it')].join('\n');
		expect(claudeAdapter.parse(text).map((m) => m.role)).toEqual(['user', 'assistant']);
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
		const ompPasted = user(
			'look at this[The user attached an image from their phone: ' +
				'/home/dev/.local/state/bordr/uploads/2-b.png — use your file-reading tool to view it ' +
				'before responding.]\n\nlook at this'
		);
		// Applied by adapterFor for every harness, not by the Claude adapter itself.
		expect(
			adapterFor('claude')!
				.parse(one + '\n' + three + '\n' + ompPasted)
				.map((m) => m.text)
		).toEqual(['📷 photo\nlook at this', '📷 3 photos', '📷 photo\nlook at this']);
	});
});

describe('blocks', () => {
	function entry(role: 'user' | 'assistant', content: unknown) {
		return JSON.stringify({ type: role, message: { content } });
	}

	it('summarises every tool from its own identifying argument, not just Bash', () => {
		// The original bug: summary came only from input.description, which
		// only Bash has, so everything else rendered as a bare name.
		expect(toolSummary('Read', { file_path: '/home/t/bordr/src/lib/projector.ts' })).toBe(
			'projector.ts'
		);
		expect(toolSummary('Grep', { pattern: 'tool_use' })).toBe('tool_use');
		expect(toolSummary('WebFetch', { url: 'https://tailscale.com/kb/1084/sharing' })).toBe(
			'tailscale.com'
		);
		expect(toolSummary('Bash', { command: 'ls', description: 'List files' })).toBe('List files');
		expect(toolSummary('Bash', { command: 'ls -la' })).toBe('ls -la');
		expect(toolSummary('TodoWrite', { todos: [1, 2, 3] })).toBe('3 items');
	});

	it('shortens an MCP tool name to its verb', () => {
		expect(toolLabel('mcp__plugin_github_github__search_code')).toBe('search_code');
		expect(toolLabel('Read')).toBe('Read');
	});

	it('attaches a tool result to the call it belongs to, across entries', () => {
		const jsonl = [
			entry('assistant', [
				{ type: 'text', text: 'Looking.' },
				{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'echo hi' } }
			]),
			entry('user', [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'hi' }])
		].join('\n');

		const [message] = claudeAdapter.parse(jsonl);
		const tool = message.blocks?.find((b) => b.kind === 'tool');
		expect(tool).toMatchObject({ name: 'Bash', summary: 'echo hi' });
		expect(tool && tool.kind === 'tool' && tool.result).toMatchObject({
			text: 'hi',
			isError: false,
			truncatedLines: 0
		});
	});

	it('reports how many result lines it dropped rather than truncating silently', () => {
		const long = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n');
		const jsonl = [
			entry('assistant', [
				{ type: 'tool_use', id: 'tu_2', name: 'Bash', input: { command: 'seq' } }
			]),
			entry('user', [{ type: 'tool_result', tool_use_id: 'tu_2', content: long }])
		].join('\n');

		const tool = claudeAdapter.parse(jsonl)[0].blocks?.find((b) => b.kind === 'tool');
		expect(tool && tool.kind === 'tool' && tool.result?.truncatedLines).toBe(20);
	});

	it('keeps both sides of an Edit so the view can diff them', () => {
		const jsonl = entry('assistant', [
			{
				type: 'tool_use',
				id: 'tu_3',
				name: 'Edit',
				input: { file_path: '/a/b/enrich.ts', old_string: 'const a = 1', new_string: 'const a = 2' }
			}
		]);
		const tool = claudeAdapter.parse(jsonl)[0].blocks?.find((b) => b.kind === 'tool');
		// The full path, deliberately: the summary beside the row already
		// carries the basename, so the diff keeps the information the summary
		// threw away.
		expect(tool && tool.kind === 'tool' && tool.diffs).toEqual([
			{
				file: '/a/b/enrich.ts',
				before: 'const a = 1',
				after: 'const a = 2'
			}
		]);
	});

	it('keeps thinking as its own block instead of dropping it', () => {
		const jsonl = entry('assistant', [
			{ type: 'thinking', thinking: 'weighing two options' },
			{ type: 'text', text: 'Going with the first.' }
		]);
		const [message] = claudeAdapter.parse(jsonl);
		expect(message.blocks?.map((b) => b.kind)).toEqual(['thinking', 'text']);
		// The flat text stays prose-only: preview and search must not start
		// quoting the model's reasoning back at the user.
		expect(message.text).toBe('Going with the first.');
	});
});

describe('AskUserQuestion', () => {
	function entry(role: 'user' | 'assistant', content: unknown) {
		return JSON.stringify({ type: role, message: { content } });
	}

	const question = {
		questions: [
			{
				question: 'How far do you want me to take it?',
				header: 'Scope',
				options: [{ label: 'All four stages' }, { label: 'Stage 1 only' }]
			}
		]
	};

	it('offers the options while the question is unanswered', () => {
		const jsonl = entry('assistant', [
			{ type: 'tool_use', id: 'ask_1', name: 'AskUserQuestion', input: question }
		]);
		expect(claudeAdapter.parse(jsonl)[0].ask).toEqual({
			question: 'How far do you want me to take it?',
			options: ['All four stages', 'Stage 1 only']
		});
	});

	it('stops offering them once the result lands', () => {
		// The answering entry renders no message of its own, so nothing else
		// would ever clear a stale card.
		const jsonl = [
			entry('assistant', [
				{ type: 'tool_use', id: 'ask_1', name: 'AskUserQuestion', input: question }
			]),
			entry('user', [{ type: 'tool_result', tool_use_id: 'ask_1', content: 'All four stages' }])
		].join('\n');
		expect(claudeAdapter.parse(jsonl)[0].ask).toBeUndefined();
	});

	it('offers only the first question, since the answer is one typed line', () => {
		const two = {
			questions: [
				{ question: 'One?', options: [{ label: 'a' }] },
				{ question: 'Two?', options: [{ label: 'b' }] }
			]
		};
		expect(askFromQuestions(two)).toEqual({ question: 'One?', options: ['a'] });
	});

	it('ignores a malformed or empty question rather than showing an empty card', () => {
		expect(askFromQuestions({ questions: [] })).toBeNull();
		expect(askFromQuestions({ questions: [{ question: 'Hm?', options: [] }] })).toBeNull();
		expect(askFromQuestions(undefined)).toBeNull();
	});
});

describe('shell commands run with !', () => {
	it('renders the command and its output as one block, not as XML', () => {
		// Claude Code records both as ordinary user string messages; without
		// this they showed as literal <bash-input> tags in the user's bubble.
		const jsonl = [
			JSON.stringify({ type: 'user', message: { content: '<bash-input>pwd</bash-input>' } }),
			JSON.stringify({
				type: 'user',
				message: {
					content: '<bash-stdout>/home/tony/bordr</bash-stdout><bash-stderr></bash-stderr>'
				}
			})
		].join('\n');

		const messages = claudeAdapter.parse(jsonl);
		expect(messages).toHaveLength(1);
		const tool = messages[0].blocks?.[0];
		expect(tool).toMatchObject({ kind: 'tool', name: '!', summary: 'pwd' });
		expect(tool && tool.kind === 'tool' && tool.result).toMatchObject({
			text: '/home/tony/bordr',
			isError: false
		});
	});

	it('marks a command that wrote to stderr as an error', () => {
		const jsonl = [
			JSON.stringify({ type: 'user', message: { content: '<bash-input>nope</bash-input>' } }),
			JSON.stringify({
				type: 'user',
				message: {
					content: '<bash-stdout></bash-stdout><bash-stderr>nope: command not found</bash-stderr>'
				}
			})
		].join('\n');
		const tool = claudeAdapter.parse(jsonl)[0].blocks?.[0];
		expect(tool && tool.kind === 'tool' && tool.result).toMatchObject({
			text: 'nope: command not found',
			isError: true
		});
	});
});

describe('claude adapter: images a tool returned', () => {
	/** A turn that calls one tool and receives `content` back from it. */
	const withResult = (content: unknown) =>
		[
			JSON.stringify({
				type: 'assistant',
				message: {
					content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.png' } }]
				}
			}),
			JSON.stringify({
				type: 'user',
				message: { content: [{ type: 'tool_result', tool_use_id: 't1', content }] }
			})
		].join('\n');

	const resultOf = (jsonl: string) => {
		const block = claudeAdapter.parse(jsonl).flatMap((m) => m.blocks ?? [])[0];
		return block && block.kind === 'tool' ? block.result : undefined;
	};

	const image = (data: string, media = 'image/png') => ({
		type: 'image',
		source: { type: 'base64', media_type: media, data }
	});

	it('turns a base64 image into a data URL', () => {
		// The shape Claude Code actually writes — verified against a real
		// transcript, where reading a PNG stored source.data inline.
		const result = resultOf(withResult([image('AAAB')]));
		expect(result?.images).toEqual(['data:image/png;base64,AAAB']);
	});

	it('keeps the text beside the picture', () => {
		const result = resultOf(withResult([{ type: 'text', text: 'read 1 image' }, image('AAAB')]));
		expect(result?.text).toBe('read 1 image');
		expect(result?.images).toEqual(['data:image/png;base64,AAAB']);
	});

	it('drops an image past the cap instead of shipping it, and counts it', () => {
		const result = resultOf(withResult([image('A'.repeat(1_500_001))]));
		expect(result?.images).toBeUndefined();
		expect(result?.imagesDropped).toBe(1);
	});

	it('ignores a source it has no bytes for', () => {
		const result = resultOf(
			withResult([{ type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }])
		);
		expect(result?.images).toBeUndefined();
		expect(result?.imagesDropped).toBeUndefined();
	});

	it('refuses a media type that would change what the data URL parses as', () => {
		// media_type is transcript content and lands in an <img src>. A comma or
		// a semicolon in it re-parses the URL, so it is matched, not trusted.
		for (const bad of ['text/html', 'image/png,x', 'image/png;charset=utf-8', '', 'png']) {
			const result = resultOf(withResult([image('AAAB', bad)]));
			expect(result?.images, bad).toBeUndefined();
		}
	});

	it('allows the image types a harness actually returns', () => {
		for (const good of ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']) {
			const result = resultOf(withResult([image('AAAB', good)]));
			expect(result?.images, good).toEqual([`data:${good};base64,AAAB`]);
		}
	});

	it('says nothing at all when a result has no image, which is nearly all of them', () => {
		const result = resultOf(withResult('plain text'));
		expect(result?.text).toBe('plain text');
		expect(result).not.toHaveProperty('images');
	});
});

describe('claude adapter: entry timestamps', () => {
	const stamp = '2026-09-11T20:23:00.419Z';

	it('carries `at` on a turn with block content, which is nearly all of them', () => {
		// Dropping it here left every message timestampless, and the view has
		// nothing to interleave a queued prompt against.
		const jsonl = JSON.stringify({
			type: 'assistant',
			timestamp: stamp,
			message: { content: [{ type: 'text', text: 'done' }] }
		});
		expect(claudeAdapter.parse(jsonl)[0].at).toBe(Date.parse(stamp));
	});

	it('carries `at` on a plain string turn too', () => {
		const jsonl = JSON.stringify({ type: 'user', timestamp: stamp, message: { content: 'hi' } });
		expect(claudeAdapter.parse(jsonl)[0].at).toBe(Date.parse(stamp));
	});

	it('omits `at` when the harness gave no timestamp', () => {
		const jsonl = JSON.stringify({ type: 'user', message: { content: 'hi' } });
		expect(claudeAdapter.parse(jsonl)[0]).not.toHaveProperty('at');
	});
});
