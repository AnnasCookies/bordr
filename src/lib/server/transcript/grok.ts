import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Adapter, Message, ToolCall } from './types';

/**
 * Grok CLI keeps `~/.grok/sessions/<url-encoded cwd>/<session id>/chat_history.jsonl`.
 * herdr reports the session id; the cwd directory is found by looking for
 * the id under every project. Record shapes measured on 2026-09-07:
 *
 *   {type:"user", prompt_index, content:[{type:"text", text:"<user_query>…</user_query>"}]}
 *   {type:"user", synthetic_reason, …}          harness scaffolding, never typed
 *   {type:"user", content:[…<user_info>…]}        the environment preamble, no prompt_index
 *   {type:"assistant", content:"…", tool_calls?:[{name, arguments:"<json>"}]}
 *   {type:"reasoning" | "system" | "tool_result"} not conversation
 */
interface Entry {
	type?: string;
	content?: string | Array<{ type?: string; text?: string }>;
	prompt_index?: number;
	synthetic_reason?: string;
	tool_calls?: Array<{ name?: string; arguments?: string }>;
}

const USER_QUERY = /<user_query>([\s\S]*?)<\/user_query>/;

function sessionsDir(): string {
	return join(process.env.GROK_HOME ?? join(homedir(), '.grok'), 'sessions');
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function toolSummary(rawArguments: string | undefined): string {
	if (!rawArguments) return '';
	try {
		const args = JSON.parse(rawArguments) as Record<string, unknown>;
		const pick = ['command', 'target_file', 'path', 'file_path', 'query', 'pattern'].find(
			(key) => typeof args[key] === 'string'
		);
		return pick ? String(args[pick]).replace(/\s+/g, ' ').trim().slice(0, 80) : '';
	} catch {
		return rawArguments.slice(0, 80);
	}
}

export const grokAdapter: Adapter = {
	async resolve(sessionId: string): Promise<string | null> {
		if (sessionId.startsWith('/')) return (await exists(sessionId)) ? sessionId : null;
		if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
		let projects: string[];
		try {
			projects = await readdir(sessionsDir());
		} catch {
			return null;
		}
		for (const project of projects) {
			const candidate = join(sessionsDir(), project, sessionId, 'chat_history.jsonl');
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
				continue;
			}
			if (parsed === null || typeof parsed !== 'object') continue;
			const entry = parsed as Entry;

			if (entry.type === 'user') {
				// Only a numbered prompt is something the person typed.
				if (entry.prompt_index === undefined || entry.synthetic_reason) continue;
				const raw = Array.isArray(entry.content)
					? entry.content.map((block) => block.text ?? '').join('\n')
					: (entry.content ?? '');
				const text = (USER_QUERY.exec(raw)?.[1] ?? raw).trim();
				if (text) messages.push({ role: 'user', text, tools: [] });
				continue;
			}
			if (entry.type !== 'assistant') continue;

			const tools: ToolCall[] = (entry.tool_calls ?? [])
				.filter((call) => call.name)
				.map((call) => ({ name: call.name as string, summary: toolSummary(call.arguments) }));
			const text = (typeof entry.content === 'string' ? entry.content : '').trim();
			if (!text && tools.length === 0) continue;
			messages.push({ role: 'assistant', text, tools });
		}
		return messages;
	}
};
