import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fromBlocks, type Adapter, type Block, type Message, type ToolResult } from './types';

interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	name?: string;
	id?: string;
	tool_use_id?: string;
	is_error?: boolean;
	content?: unknown;
	input?: Record<string, unknown>;
}

/** Result output past this is folded away; the row says how much was dropped. */
const MAX_RESULT_LINES = 40;
/** A summary is one line on a phone. */
const SUMMARY_CHARS = 72;

function clip(value: string, max = SUMMARY_CHARS): string {
	const line = value.replace(/\s+/g, ' ').trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function base(path: unknown): string {
	return typeof path === 'string' ? (path.split('/').pop() ?? path) : '';
}

function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/**
 * The one argument that identifies a call.
 *
 * Only Bash carries `input.description`, which is why every other tool used to
 * render as a bare name with an empty column beside it. Everything needed was
 * already in `input`; this just names the field per tool.
 */
export function toolSummary(name: string, input: Record<string, unknown> = {}): string {
	const description = str(input.description);
	switch (name) {
		case 'Bash':
			return clip(description || str(input.command));
		case 'Read':
		case 'Write':
		case 'NotebookEdit':
			return base(input.file_path ?? input.notebook_path);
		case 'Edit':
			return base(input.file_path);
		case 'Grep':
			return clip(str(input.pattern));
		case 'Glob':
			return clip(str(input.pattern));
		case 'WebSearch':
			return clip(str(input.query));
		case 'WebFetch':
			try {
				return new URL(str(input.url)).hostname;
			} catch {
				return clip(str(input.url));
			}
		case 'Skill':
			return clip(str(input.skill));
		case 'Task':
		case 'Agent':
			return clip(description || str(input.subagent_type));
		case 'ToolSearch':
			return clip(str(input.query));
		case 'TodoWrite': {
			const todos = input.todos;
			return Array.isArray(todos) ? `${todos.length} items` : '';
		}
		default:
			break;
	}
	if (description) return clip(description);
	// MCP tools carry arbitrary shapes; the first short string is nearly always
	// the identifying one (a query, a path, an id) and is better than nothing.
	for (const value of Object.values(input)) {
		if (typeof value === 'string' && value.length > 0 && value.length <= 120) return clip(value);
	}
	return '';
}

/** `mcp__plugin_github_github__search_code` reads as `search_code` on a phone. */
export function toolLabel(name: string): string {
	if (!name.startsWith('mcp__')) return name;
	const tail = name.split('__').pop();
	return tail ? tail : name;
}

/**
 * Claude Code asks through the AskUserQuestion tool rather than a terminal
 * dialog, so nothing appears on the pane's screen for the picker parser to
 * find. The options are in the tool input; the phone answers by typing the
 * label back, exactly as it does for codex's request_user_input.
 *
 * Only the first question travels: the answer goes back as one typed line, so
 * offering options from two questions at once would send an answer to the
 * wrong one.
 */
export function askFromQuestions(input: Record<string, unknown> | undefined) {
	const questions = input?.questions;
	if (!Array.isArray(questions) || questions.length === 0) return null;
	const first = questions[0] as { question?: unknown; options?: unknown };
	const question = str(first.question);
	const options = Array.isArray(first.options)
		? first.options
				.map((option) => str((option as { label?: unknown })?.label))
				.filter((label) => label.length > 0)
		: [];
	if (!question || options.length === 0) return null;
	return { question, options };
}

/** A tool_result's content is a string or a block array; flatten either. */
function resultText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((part) => {
			if (typeof part === 'string') return part;
			if (part && typeof part === 'object' && typeof (part as ContentBlock).text === 'string') {
				return (part as ContentBlock).text as string;
			}
			return '';
		})
		.filter(Boolean)
		.join('\n');
}

/**
 * The biggest single image worth inlining, in base64 characters.
 *
 * ponytail: a flat cap, and the picture travels in the JSON payload as a
 * `data:` URL. That is the whole feature in one field — no cache directory, no
 * route, no id scheme to keep in step with the transcript. A screenshot off a
 * phone is comfortably inside it. If these ever need to be bigger or lazier,
 * the upgrade is to write them under BORDR_DATA_DIR and serve by content hash,
 * the way uploads already work.
 */
const MAX_IMAGE_B64 = 1_500_000;

/** Total base64 across one result, so a tool returning twenty stays bounded. */
const MAX_IMAGES_B64 = 6_000_000;

/**
 * A media type safe to interpolate into a `data:` URL, and actually an image.
 *
 * `media_type` is transcript content, and it lands in the DOM inside an
 * `<img src>`. A value carrying a `,` or a `;` would change what the URL
 * parses as rather than being read as a type, so it is matched rather than
 * trusted. Anchored to `image/` on top: nothing else belongs in an <img>, and
 * a data: URL announcing some other type is a broken image at best.
 */
const IMAGE_MEDIA = /^image\/[a-z0-9][a-z0-9.+-]*$/i;

/**
 * The images in a tool_result, as `data:` URLs.
 *
 * Claude Code stores them inline and base64 already, so this is a re-wrapping
 * rather than a read: `{type:'image', source:{type:'base64', media_type, data}}`.
 * A source that is not base64 (a URL form exists) is left alone — there is no
 * bytes to wrap.
 */
function resultImages(content: unknown): { images: string[]; dropped: number } {
	if (!Array.isArray(content)) return { images: [], dropped: 0 };
	const images: string[] = [];
	let dropped = 0;
	let budget = MAX_IMAGES_B64;
	for (const part of content) {
		if (!part || typeof part !== 'object') continue;
		const block = part as {
			type?: unknown;
			source?: { type?: unknown; media_type?: unknown; data?: unknown };
		};
		if (block.type !== 'image') continue;
		const source = block.source;
		if (!source || source.type !== 'base64') continue;
		const { media_type: media, data } = source;
		if (typeof media !== 'string' || !IMAGE_MEDIA.test(media)) continue;
		if (typeof data !== 'string' || !data) continue;
		if (data.length > MAX_IMAGE_B64 || data.length > budget) {
			dropped++;
			continue;
		}
		budget -= data.length;
		images.push(`data:${media};base64,${data}`);
	}
	return { images, dropped };
}

function toResult(block: ContentBlock): ToolResult {
	const full = resultText(block.content).replace(/\s+$/, '');
	const lines = full.split('\n');
	const kept = lines.slice(0, MAX_RESULT_LINES);
	const { images, dropped } = resultImages(block.content);
	return {
		text: kept.join('\n'),
		isError: block.is_error === true,
		truncatedLines: Math.max(0, lines.length - kept.length),
		// Omitted rather than empty: every result carries this shape, and an
		// empty array on each is bytes down the wire for nothing.
		...(images.length > 0 && { images }),
		...(dropped > 0 && { imagesDropped: dropped })
	};
}

/**
 * Claude Code keeps transcripts under its config directory, which
 * CLAUDE_CONFIG_DIR relocates. Read per call rather than at import so the
 * variable can be set for bordr's own process and honoured without a restart
 * of the module — bordr does not inherit the agent's environment, so the
 * operator sets it on the service.
 */
function projectsDir(): string {
	const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
	return join(configDir, 'projects');
}

/** Transcript entries that are harness machinery, not conversation. */
const MACHINERY_PREFIXES = ['<command-message>', '<local-command-caveat>', '<system-reminder>'];

/**
 * A shell command run from the composer with `!`, and its output.
 *
 * Claude Code records these as two ordinary `user` string messages, so
 * without this they rendered as literal XML in your own blue bubble:
 * `<bash-input>pwd</bash-input>` followed by
 * `<bash-stdout>/home/tony</bash-stdout><bash-stderr></bash-stderr>`. They are
 * a command and its result, so they render as one.
 */
const BASH_INPUT = /^<bash-input>([\s\S]*)<\/bash-input>$/;
const BASH_STDOUT = /<bash-stdout>([\s\S]*?)<\/bash-stdout>/;
const BASH_STDERR = /<bash-stderr>([\s\S]*?)<\/bash-stderr>/;

/**
 * More of Claude Code's own voice in the `user` role, none of it flagged:
 * a background agent finishing (multi-kilobyte reports, sometimes behind a
 * "[SYSTEM NOTIFICATION]" preamble), the summary it writes to itself after
 * compacting, and the marker it leaves when a person interrupts. Each
 * becomes a one-line system note rather than a wall of "you said".
 */
const TASK_NOTIFICATION = /<task-notification>/;
const TASK_SUMMARY = /<summary>([\s\S]*?)<\/summary>/;
const SYSTEM_NOTIFICATION = /^\s*\[SYSTEM NOTIFICATION/;
const CONTINUATION = /^\s*This session is being continued from a previous conversation/;
const INTERRUPTED = /^\s*\[Request interrupted by user/;
/** Both forms Claude Code uses when a skill is invoked again in one session. */
const COMMAND_NAME = /<command-name>([^<]+)<\/command-name>/;
const COMMAND_STDOUT = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/;
const SKILL_HEADER = /^Base directory for this skill:\s*(\S+)/;
const SKILL_REINVOKED = /^(?:\(Re-invocation of|Skill) \/([\w:-]+)/;
const TEAMMATE = /<teammate-message\s+([^>]*)>/;
const TEAMMATE_ID = /teammate_id="([^"]*)"/;
const TEAMMATE_SUMMARY = /summary="([^"]*)"/;

/**
 * Content Claude Code writes into the `user` role that the human never typed:
 * skill bodies, system reminders, inter-agent messages, image metadata, compact
 * stubs. Rendering it as chat puts it in the user's own blue bubble, so a whole
 * skill body reads as though it were typed from the phone.
 *
 * `isMeta` flags most of it and flags nothing genuine (measured across 60
 * transcripts: 819 typed messages, none flagged). It is not sufficient alone —
 * inter-agent messages go unflagged in some versions (337 of 365 measured), so
 * the tag itself is the reliable signal there.
 */
function isInjected(isMeta: boolean, text: string): boolean {
	return (
		isMeta ||
		TEAMMATE.test(text) ||
		text.startsWith('Another Claude session sent') ||
		TASK_NOTIFICATION.test(text) ||
		SYSTEM_NOTIFICATION.test(text) ||
		CONTINUATION.test(text) ||
		INTERRUPTED.test(text)
	);
}

/**
 * The subdued system line injected content should render as, or null to drop
 * it. Skill loads and inter-agent messages are real events worth seeing —
 * summarised, the way a slash command becomes "→ /model" rather than vanishing.
 */
function injectedMessage(text: string): Message | null {
	if (TASK_NOTIFICATION.test(text)) {
		const summary = TASK_SUMMARY.exec(text)?.[1].replace(/\s+/g, ' ').trim();
		const clipped = summary && summary.length > 120 ? `${summary.slice(0, 119)}…` : summary;
		return {
			role: 'system',
			text: clipped ? `→ background task: ${clipped}` : '→ background task finished',
			tools: []
		};
	}
	if (SYSTEM_NOTIFICATION.test(text)) return null;
	if (CONTINUATION.test(text)) return { role: 'system', text: '→ context compacted', tools: [] };
	if (INTERRUPTED.test(text)) return { role: 'system', text: '→ interrupted', tools: [] };

	const skill = SKILL_HEADER.exec(text);
	if (skill) {
		const name = skill[1].split('/').filter(Boolean).at(-1);
		if (name) return { role: 'system', text: `→ skill: ${name}`, tools: [] };
	}

	const again = SKILL_REINVOKED.exec(text);
	if (again) return { role: 'system', text: `→ skill: ${again[1]}`, tools: [] };

	const teammate = TEAMMATE.exec(text);
	if (teammate) {
		const attributes = teammate[1];
		const id = TEAMMATE_ID.exec(attributes)?.[1] ?? 'another agent';
		const summary = TEAMMATE_SUMMARY.exec(attributes)?.[1];
		// The bodies are multi-kilobyte coordination payloads; on a phone the
		// useful part is who spoke, not the handover itself.
		return {
			role: 'system',
			text: summary ? `→ ${id}: ${summary}` : `→ message from ${id}`,
			tools: []
		};
	}

	return null;
}

/** Slash-command entries become subdued system lines instead of vanishing —
 *  typing /usage from the phone should visibly do something. */
function systemMessage(content: string): Message | null {
	const name = COMMAND_NAME.exec(content);
	if (name) return { role: 'system', text: `→ ${name[1].trim()}`, tools: [] };
	const stdout = COMMAND_STDOUT.exec(content);
	if (stdout) {
		const text = stdout[1].trim();
		if (!text || text === '(no content)') return null;
		return { role: 'system', text, tools: [] };
	}
	return null;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Does every turn in this file belong to a sidechain?
 *
 * True only for a sub-agent's own transcript, where the flag is on all of
 * them. Returns false the moment an ordinary turn appears, so a session
 * transcript — which opens with one — costs a line or two rather than a full
 * parse of a file that can run to megabytes.
 *
 * False for a file with no turns at all: there is nothing to rescue, and
 * "everything here is a sidechain" is a claim an empty file cannot support.
 */
export function onlySidechain(jsonl: string): boolean {
	let sawTurn = false;
	for (const line of jsonl.split('\n')) {
		if (!line.trim()) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (parsed === null || typeof parsed !== 'object') continue;
		const entry = parsed as { type?: string; isSidechain?: boolean };
		if (entry.type !== 'user' && entry.type !== 'assistant') continue;
		if (entry.isSidechain !== true) return false;
		sawTurn = true;
	}
	return sawTurn;
}

export const claudeAdapter: Adapter = {
	/**
	 * herdr reports agent_session.value as the transcript's basename, but the
	 * project sub-directory depends on the pane's cwd — so search for it. An
	 * absolute path is taken as-is, the way the other adapters do.
	 */
	async resolve(sessionId: string): Promise<string | null> {
		if (sessionId.startsWith('/')) return (await exists(sessionId)) ? sessionId : null;

		const projects = projectsDir();
		let names: string[];
		try {
			names = await readdir(projects);
		} catch {
			return null;
		}
		for (const project of names) {
			const candidate = join(projects, project, `${sessionId}.jsonl`);
			if (await exists(candidate)) return candidate;
		}
		return null;
	},

	parse(jsonl: string): Message[] {
		const messages: Message[] = [];
		/**
		 * Whether this file is a SUB-AGENT's own transcript.
		 *
		 * `isSidechain` does not mean "not a real turn" — it means "belongs to a
		 * different conversation than the one this file is". In a session's own
		 * transcript those turns are a sub-agent's and are correctly skipped. In
		 * a sub-agent's file EVERY entry carries the flag, because from the
		 * session's point of view the whole file is a sidechain — so the same
		 * rule threw the entire conversation away and the sheet opened empty.
		 *
		 * Decided per FILE rather than per entry, which needs no flag plumbed
		 * through the five wrappers between here and the endpoint. A session
		 * transcript answers this on its first turn or two; only a sub-agent's
		 * file is read to the end, and only when one is opened.
		 */
		const sidechainOnly = onlySidechain(jsonl);
		/** tool_use id -> the block awaiting its result, which lands later. */
		const pending = new Map<string, Block>();
		/**
		 * Questions asked through AskUserQuestion, with the block that carries
		 * their answer. Resolved after the whole file is read: the result lands
		 * in a later entry, and an answered question must not still be offered.
		 */
		const asked: Array<{ at: number; tool: Block }> = [];
		/** The `!` command still waiting for its output entry. */
		let lastBash: Block | null = null;
		for (const line of jsonl.split('\n')) {
			if (!line.trim()) continue;

			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue; // a truncated final line while the agent is mid-write
			}
			// A bare `null` or scalar line is valid JSON; reading `.type` off it
			// would throw and cost the whole conversation, not just the line.
			if (parsed === null || typeof parsed !== 'object') continue;
			const entry = parsed as {
				timestamp?: string;
				type?: string;
				isMeta?: boolean;
				isSidechain?: boolean;
				message?: { content?: string | ContentBlock[] };
			};

			if (entry.type !== 'user' && entry.type !== 'assistant') continue;
			// Epoch ms, so the view can interleave a prompt that has been sent
			// but not yet written here. 0 when the harness omitted it.
			const at = entry.timestamp ? Date.parse(entry.timestamp) || 0 : 0;
			// Sub-agent turns share the file but are not this conversation —
			// unless the file IS the sub-agent's, where they are all there is.
			if (entry.isSidechain === true && !sidechainOnly) continue;
			const content = entry.message?.content;
			const isMeta = entry.isMeta === true;

			// Typed user messages arrive as a PLAIN STRING (measured: the
			// dominant form in real transcripts); block arrays carry tool
			// results and attachments. Slash-command machinery is string-form
			// too and must not render as chat.
			if (typeof content === 'string') {
				if (content.startsWith('<command-name>') || content.startsWith('<local-command-stdout>')) {
					const system = systemMessage(content);
					if (system) messages.push(system);
					continue;
				}
				const command = BASH_INPUT.exec(content.trim());
				if (command) {
					// The output lands in the NEXT entry, so the block is held
					// open the same way a tool_use waits for its tool_result.
					const tool: Block = {
						kind: 'tool',
						name: '!',
						summary: clip(command[1]),
						input: { command: command[1] },
						result: null,
						diffs: []
					};
					lastBash = tool;
					messages.push(fromBlocks('user', [tool], undefined, at));
					continue;
				}
				if (content.startsWith('<bash-stdout>')) {
					const out = BASH_STDOUT.exec(content)?.[1] ?? '';
					const err = BASH_STDERR.exec(content)?.[1] ?? '';
					if (lastBash && lastBash.kind === 'tool') {
						const text = [out, err].filter((part) => part.trim()).join('\n');
						lastBash.result = {
							text,
							isError: err.trim().length > 0,
							truncatedLines: 0
						};
						lastBash = null;
					}
					// Never its own message: it belongs to the command above it.
					continue;
				}
				if (MACHINERY_PREFIXES.some((prefix) => content.startsWith(prefix))) continue;
				if (!content.trim()) continue;
				if (isInjected(isMeta, content)) {
					const system = injectedMessage(content);
					if (system) messages.push(system);
					continue;
				}
				// Omitted when 0, so a message with no timestamp keeps the shape
				// it has always had rather than carrying a meaningless field.
				messages.push({ role: entry.type, text: content, tools: [], ...(at ? { at } : {}) });
				continue;
			}

			const content_blocks = content;
			if (!Array.isArray(content_blocks)) continue;

			const blocks: Block[] = [];
			let ask: Message['ask'] | undefined;
			for (const block of content_blocks) {
				if (block.type === 'text' && block.text) {
					blocks.push({ kind: 'text', text: block.text });
				} else if (block.type === 'thinking' && block.thinking) {
					blocks.push({ kind: 'thinking', text: block.thinking });
				} else if (block.type === 'tool_use' && block.name) {
					const tool: Block = {
						kind: 'tool',
						name: toolLabel(block.name),
						summary: toolSummary(block.name, block.input ?? {}),
						input: block.input ?? null,
						result: null,
						diffs:
							block.name === 'Edit' && typeof block.input?.old_string === 'string'
								? [
										{
											file: str(block.input.file_path),
											before: str(block.input.old_string),
											after: str(block.input.new_string)
										}
									]
								: []
					};
					blocks.push(tool);
					// The result arrives in a LATER entry, keyed by this id, so
					// the block is held open until then rather than re-scanned.
					if (block.id) pending.set(block.id, tool);
					if (block.name === 'AskUserQuestion') {
						const question = askFromQuestions(block.input);
						if (question) {
							ask = question;
							asked.push({ at: messages.length, tool });
						}
					}
				} else if (block.type === 'tool_result' && block.tool_use_id) {
					const tool = pending.get(block.tool_use_id);
					if (tool && tool.kind === 'tool') {
						tool.result = toResult(block);
						pending.delete(block.tool_use_id);
					}
				}
			}

			// Entries carrying only tool results or other machinery render as
			// empty bubbles — skip them. A tool_result attaches to a block that
			// is already on screen, so it contributes nothing of its own here.
			if (blocks.length === 0) continue;

			// Block form too: skill bodies arrive as a `text` block, and a prefix
			// check cannot catch them — the body simply starts with prose.
			const joined = blocks
				.filter((b) => b.kind === 'text')
				.map((b) => (b as { text: string }).text)
				.join('\n\n');
			if (isInjected(isMeta, joined)) {
				const system = injectedMessage(joined);
				if (system) messages.push(system);
				continue;
			}

			// `at` matters: it is what lets the view slot a prompt that has been
			// sent but not yet written into its real place. Omitting it here —
			// the path nearly every turn takes — left every message timestampless
			// and every queued prompt piled at the bottom of the transcript.
			messages.push(fromBlocks(entry.type, blocks, ask, at));
		}
		// A question that has been answered is no longer pending. The result
		// arrives in an entry that renders no message of its own, so nothing
		// else would ever clear the card.
		for (const { at, tool } of asked) {
			if (tool.kind === 'tool' && tool.result !== null) delete messages[at]?.ask;
		}
		return messages;
	}
};
