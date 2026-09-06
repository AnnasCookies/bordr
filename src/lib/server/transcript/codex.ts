import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Adapter, Message, ToolCall } from './types';

interface ContentBlock {
	type?: string;
	text?: string;
}

interface Payload {
	type?: string;
	role?: string;
	content?: ContentBlock[];
	name?: string;
	arguments?: string;
	action?: { command?: string[] };
}

interface Entry {
	type?: string;
	payload?: Payload;
}

/** Text-bearing block types across codex payload shapes. */
const TEXT_TYPES = new Set(['output_text', 'input_text', 'text']);

/**
 * A message that is exactly one `<tag …>…</tag>` wrapper, open and close
 * matching, with no earlier close of the same tag. The per-character
 * lookahead is what makes `<a>x</a> and <a>y</a>` fail — two wrappers.
 */
const SINGLE_TAG_WRAPPER = /^<([A-Za-z_][\w-]*)(?:\s[^>]*)?>(?:(?!<\/\1>)[\s\S])*<\/\1>$/;

/**
 * codex injects the project's AGENTS.md as a USER message, so without this
 * the conversation opens with a wall of instructions the user never typed.
 * It wraps the rest of its scaffolding — `<environment_context>`,
 * `<user_instructions>`, `<recommended_plugins>` and whatever comes next —
 * in a single tag the same way, so any lone well-formed wrapper is treated
 * as injected. A person who merely mentions a tag mid-sentence is not.
 */
function isInjectedContext(text: string): boolean {
	const trimmed = text.trim();
	return (
		/^#\s*AGENTS\.md instructions/i.test(trimmed) ||
		(text.includes('<INSTRUCTIONS>') && text.includes('</INSTRUCTIONS>')) ||
		/^<environment_context>/i.test(trimmed) ||
		/^<user_instructions>/i.test(trimmed) ||
		SINGLE_TAG_WRAPPER.test(trimmed)
	);
}

/** `{"questions":[{"title":"Which colour?","options":["Red","Green","Blue"]}]}` */
function askFrom(payload: Payload): Message['ask'] | null {
	if (typeof payload.arguments !== 'string') return null;
	try {
		const args = JSON.parse(payload.arguments) as {
			questions?: Array<{ title?: string; options?: unknown[] }>;
		};
		const first = args.questions?.[0];
		if (!first?.title) return null;
		const options = (first.options ?? []).filter((o): o is string => typeof o === 'string');
		return { question: first.title, options };
	} catch {
		return null;
	}
}

function summarise(payload: Payload): string {
	if (Array.isArray(payload.action?.command)) return payload.action.command.join(' ').slice(0, 80);
	if (typeof payload.arguments === 'string') {
		try {
			const args = JSON.parse(payload.arguments) as Record<string, unknown>;
			const first = args.command ?? args.path ?? args.file_path ?? args.query;
			if (typeof first === 'string') return first.slice(0, 80);
			if (Array.isArray(first)) return first.join(' ').slice(0, 80);
		} catch {
			return payload.arguments.slice(0, 80);
		}
	}
	return '';
}

/**
 * codex rollout transcripts: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`,
 * one `{type:"response_item", payload:{…}}` per line.
 *
 * `developer` messages are harness scaffolding (instructions, environment
 * context) and never rendered; `reasoning` payloads carry encrypted content
 * and are skipped too.
 */
/** Codex keeps its state under CODEX_HOME, `~/.codex` by default. */
function sessionsDir(): string {
	return join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');
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
 * Newest day first: the pane is live, so its rollout is almost always in
 * today's directory, and a session tree can hold years of days.
 */
async function subdirsNewestFirst(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort()
			.reverse();
	} catch {
		return [];
	}
}

export const codexAdapter: Adapter = {
	async resolve(sessionId: string): Promise<string | null> {
		// Older herdr integrations reported the rollout's absolute path; the
		// current one (v8) reports the session id, like Claude's, and the
		// file is `sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl`.
		if (sessionId.startsWith('/')) return (await exists(sessionId)) ? sessionId : null;
		if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;

		const root = sessionsDir();
		const suffix = `-${sessionId}.jsonl`;
		for (const year of await subdirsNewestFirst(root)) {
			for (const month of await subdirsNewestFirst(join(root, year))) {
				for (const day of await subdirsNewestFirst(join(root, year, month))) {
					const dir = join(root, year, month, day);
					let names: string[];
					try {
						names = await readdir(dir);
					} catch {
						continue;
					}
					const hit = names.find((name) => name.startsWith('rollout-') && name.endsWith(suffix));
					if (hit) return join(dir, hit);
				}
			}
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
				continue;
			}
			// Same guard as the Claude adapter: `null` is JSON, and `.type` on it throws.
			if (parsed === null || typeof parsed !== 'object') continue;
			const entry = parsed as Entry;
			if (entry.type !== 'response_item') continue;
			const payload = entry.payload;
			if (!payload) continue;

			if (payload.type === 'message') {
				const role = payload.role;
				if (role !== 'user' && role !== 'assistant') continue; // developer = scaffolding
				const text = (payload.content ?? [])
					.filter((b) => b.type && TEXT_TYPES.has(b.type) && b.text)
					.map((b) => b.text as string)
					.join('\n\n');
				if (!text.trim()) continue;
				if (role === 'user' && isInjectedContext(text)) continue;
				messages.push({ role, text, tools: [] });
				continue;
			}

			// Tool activity attaches to the preceding assistant turn so the
			// UI can fold it behind "show the work", as it does for Claude.
			if (payload.type && /function_call|local_shell_call|custom_tool_call/.test(payload.type)) {
				const tool: ToolCall = {
					name: payload.name ?? (payload.action?.command ? 'shell' : 'tool'),
					summary: summarise(payload)
				};
				// request_user_input(_async) carries the question and options;
				// the phone turns it into a card and types the answer back.
				const ask = /request_user_input/.test(tool.name) ? askFrom(payload) : null;
				if (ask) {
					tool.summary = ask.question;
					messages.push({ role: 'assistant', text: '', tools: [tool], ask });
					continue;
				}
				const last = messages.at(-1);
				if (last?.role === 'assistant') last.tools.push(tool);
				else messages.push({ role: 'assistant', text: '', tools: [tool] });
			}
		}
		return messages;
	}
};
