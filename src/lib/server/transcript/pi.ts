import { access } from 'node:fs/promises';
import type { Adapter, Message, ToolCall } from './types';

interface Block {
	type: string;
	text?: string;
	name?: string;
	arguments?: { i?: string; command?: string; path?: string } | string;
}

interface Entry {
	type?: string;
	message?: { role?: string; content?: string | Block[] };
}

function toolSummary(block: Block): string {
	const args = typeof block.arguments === 'string' ? undefined : block.arguments;
	return args?.i ?? args?.command?.slice(0, 80) ?? args?.path ?? '';
}

/**
 * pi and omp share one session format (omp is a pi fork): entries of
 * {type:"message", message:{role, content:[blocks]}} with text / thinking /
 * toolCall blocks, plus toolResult-role messages and custom entries that are
 * not conversation. herdr reports their agent_session as an absolute path.
 */
export const piAdapter: Adapter = {
	async resolve(sessionId: string): Promise<string | null> {
		if (!sessionId.startsWith('/')) return null;
		try {
			await access(sessionId);
			return sessionId;
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
			// A bare `null` or scalar line parses fine and then throws on `.type`,
			// taking the whole conversation down to the snapshot.
			if (typeof parsed !== 'object' || parsed === null) continue;
			const entry = parsed as Entry;

			if (entry.type !== 'message') continue;
			const role = entry.message?.role;
			if (role !== 'user' && role !== 'assistant') continue; // toolResult etc.

			const content = entry.message?.content;
			if (typeof content === 'string') {
				if (content.trim()) messages.push({ role, text: content, tools: [] });
				continue;
			}
			if (!Array.isArray(content)) continue;

			const text: string[] = [];
			const tools: ToolCall[] = [];
			for (const block of content) {
				if (block.type === 'text' && block.text) text.push(block.text);
				if (block.type === 'toolCall' && block.name) {
					tools.push({ name: block.name, summary: toolSummary(block) });
				}
				// thinking blocks are deliberately not rendered
			}
			if (text.length === 0 && tools.length === 0) continue;
			messages.push({ role, text: text.join('\n\n'), tools });
		}
		return messages;
	}
};
