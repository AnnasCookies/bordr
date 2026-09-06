import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Adapter, Message, ToolCall } from './types';

/**
 * GitHub Copilot CLI keeps `~/.copilot/session-state/<session id>/events.jsonl`,
 * one typed event per line. herdr reports the session id. Events measured on
 * 2026-09-07: user.message, assistant.message (with the turn's toolRequests),
 * tool.execution_start / _complete, plus session, hook and system events
 * that are not conversation.
 */
interface Event {
	type?: string;
	data?: {
		content?: string;
		toolName?: string;
		arguments?: Record<string, unknown>;
		toolRequests?: Array<{ name?: string; arguments?: Record<string, unknown> }>;
	};
}

function sessionsDir(): string {
	return join(process.env.COPILOT_HOME ?? join(homedir(), '.copilot'), 'session-state');
}

function toolSummary(args: Record<string, unknown> | undefined): string {
	if (!args) return '';
	const pick = ['intent', 'command', 'path', 'file_path', 'query', 'pattern'].find(
		(key) => typeof args[key] === 'string'
	);
	return pick ? String(args[pick]).replace(/\s+/g, ' ').trim().slice(0, 80) : '';
}

export const copilotAdapter: Adapter = {
	async resolve(sessionId: string): Promise<string | null> {
		const path = sessionId.startsWith('/')
			? sessionId
			: /^[0-9a-f-]{36}$/i.test(sessionId)
				? join(sessionsDir(), sessionId, 'events.jsonl')
				: null;
		if (!path) return null;
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
			const event = parsed as Event;
			const data = event.data ?? {};

			if (event.type === 'user.message') {
				const text = (data.content ?? '').trim();
				if (text) messages.push({ role: 'user', text, tools: [] });
				continue;
			}
			if (event.type === 'assistant.message') {
				const text = (data.content ?? '').trim();
				if (text) messages.push({ role: 'assistant', text, tools: [] });
				continue;
			}
			if (event.type === 'tool.execution_start' && data.toolName) {
				// Each tool call is its own row; Copilot reports intent as a tool.
				const tool: ToolCall = { name: data.toolName, summary: toolSummary(data.arguments) };
				messages.push({ role: 'assistant', text: '', tools: [tool] });
			}
		}
		return messages;
	}
};
