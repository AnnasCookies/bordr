import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Adapter, Message, ToolCall } from './types';

/**
 * agy (Antigravity CLI, Gemini's harness) keeps one transcript per session at
 * `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`,
 * and herdr reports that id. Record kinds measured on 2026-09-07:
 *
 *   USER_INPUT / USER_EXPLICIT   the person, inside <USER_REQUEST> tags
 *   PLANNER_RESPONSE / MODEL     the model: `content`, `tool_calls`, `thinking`
 *   GENERIC / MODEL              tool output ("Created At … Completed At …")
 *   SYSTEM_MESSAGE / SYSTEM      harness scaffolding "not actually sent by the user"
 *   CHECKPOINT / SYSTEM          the summary it writes after compacting
 */
interface Entry {
	type?: string;
	source?: string;
	content?: string;
	thinking?: string;
	tool_calls?: Array<{ name?: string; args?: Record<string, unknown> }>;
}

const USER_REQUEST = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/;

function brainDir(): string {
	return join(process.env.GEMINI_HOME ?? join(homedir(), '.gemini'), 'antigravity-cli', 'brain');
}

/** The one-line gist of a tool call: its own summary if it wrote one, else the argument that matters. */
function toolSummary(args: Record<string, unknown> | undefined): string {
	if (!args) return '';
	const pick = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
	const summary =
		pick('toolSummary') ?? pick('CommandLine') ?? pick('AbsolutePath') ?? pick('Query');
	return (summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export const agyAdapter: Adapter = {
	async resolve(sessionId: string): Promise<string | null> {
		if (sessionId.startsWith('/')) {
			try {
				await access(sessionId);
				return sessionId;
			} catch {
				return null;
			}
		}
		if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
		const path = join(brainDir(), sessionId, '.system_generated', 'logs', 'transcript.jsonl');
		try {
			await access(path);
			return path;
		} catch {
			return null;
		}
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

			if (entry.type === 'USER_INPUT') {
				const text = (USER_REQUEST.exec(entry.content ?? '')?.[1] ?? entry.content ?? '').trim();
				if (text) messages.push({ role: 'user', text, tools: [] });
				continue;
			}
			if (entry.type === 'CHECKPOINT') {
				messages.push({ role: 'system', text: '→ context compacted', tools: [] });
				continue;
			}
			if (entry.type !== 'PLANNER_RESPONSE' || entry.source !== 'MODEL') continue;

			const tools: ToolCall[] = (entry.tool_calls ?? [])
				.filter((call) => call.name)
				.map((call) => ({ name: call.name as string, summary: toolSummary(call.args) }));
			const text = (entry.content ?? '').trim();
			if (!text && tools.length === 0) continue; // a thinking-only step
			messages.push({ role: 'assistant', text, tools });
		}
		return messages;
	}
};
