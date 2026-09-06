import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Adapter, Message, ToolCall } from './types';

interface ContentBlock {
	type: string;
	text?: string;
	name?: string;
	input?: { description?: string };
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
				type?: string;
				isMeta?: boolean;
				isSidechain?: boolean;
				message?: { content?: string | ContentBlock[] };
			};

			if (entry.type !== 'user' && entry.type !== 'assistant') continue;
			// Sub-agent turns share the file but are not this conversation.
			if (entry.isSidechain === true) continue;
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
				if (MACHINERY_PREFIXES.some((prefix) => content.startsWith(prefix))) continue;
				if (!content.trim()) continue;
				if (isInjected(isMeta, content)) {
					const system = injectedMessage(content);
					if (system) messages.push(system);
					continue;
				}
				messages.push({ role: entry.type, text: content, tools: [] });
				continue;
			}

			const blocks = content;
			if (!Array.isArray(blocks)) continue;

			const text: string[] = [];
			const tools: ToolCall[] = [];
			for (const block of blocks) {
				if (block.type === 'text' && block.text) text.push(block.text);
				if (block.type === 'tool_use' && block.name) {
					tools.push({ name: block.name, summary: block.input?.description ?? '' });
				}
			}

			// Entries carrying only tool results or other machinery render as
			// empty bubbles — skip them.
			if (text.length === 0 && tools.length === 0) continue;

			// Block form too: skill bodies arrive as a `text` block, and a prefix
			// check cannot catch them — the body simply starts with prose.
			const joined = text.join('\n\n');
			if (isInjected(isMeta, joined)) {
				const system = injectedMessage(joined);
				if (system) messages.push(system);
				continue;
			}

			messages.push({ role: entry.type, text: joined, tools });
		}
		return messages;
	}
};
