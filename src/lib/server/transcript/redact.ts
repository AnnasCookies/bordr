import type { TodoPlan } from '$lib/todo-plan';
import type { Adapter, Block, EditDiff, Message, ToolResult } from './types';

const PRIVATE_KEY_BLOCK = /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g;
const PRIVATE_KEY_TAIL = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*$/g;
const QUOTED_SECRET_PREFIX =
	/((?:\\*["'])?(?:[a-z0-9_-]*(?:token|secret|password|passwd|api[-_]?key|private[-_]?key)[a-z0-9_-]*|authorization)(?:\\*["'])?\s*[:=]\s*)(\\*)(["'])/gi;
const SECRET_ASSIGNMENT =
	/((?:\\*["'])?(?:[a-z0-9_-]*(?:token|secret|password|passwd|api[-_]?key|private[-_]?key)[a-z0-9_-]*|authorization)(?:\\*["'])?\s*[:=]\s*(?:\\*["'])?)((?!\[REDACTED\])[^\s\\"',}\]]+)((?:\\*["'])?)/gi;
const AUTHORIZATION_HEADER = /(\bAuthorization\s*:\s*)(?!\\*["'])[^\r\n]+/gi;
const BEARER = /(\bBearer\s+)[a-z0-9._~+/=-]{16,}/gi;
const SECRET_KEY_PART = /(?:token|secret|password|passwd|apikey|privatekey)/;

function isSecretKey(key: string): boolean {
	const normalised = key.toLowerCase().replace(/[_-]/g, '');
	return normalised === 'authorization' || SECRET_KEY_PART.test(normalised);
}

function isQuotedAssignmentBoundary(text: string, index: number): boolean {
	const next = text[index];
	return next === undefined || ' \t\r\n,}];#'.includes(next);
}

function redactQuotedAssignments(text: string): string {
	const output: string[] = [];
	let copiedThrough = 0;
	QUOTED_SECRET_PREFIX.lastIndex = 0;

	for (
		let match = QUOTED_SECRET_PREFIX.exec(text);
		match;
		match = QUOTED_SECRET_PREFIX.exec(text)
	) {
		const openingEscapes = match[2].length;
		const quote = match[3];
		const valueStart = QUOTED_SECRET_PREFIX.lastIndex;
		let closingStart = -1;
		let closingEnd = -1;

		for (let index = valueStart; index < text.length; index++) {
			if (text[index] !== quote) continue;
			let slashStart = index;
			while (slashStart > valueStart && text[slashStart - 1] === '\\') slashStart--;
			if (index - slashStart !== openingEscapes) continue;
			if (!isQuotedAssignmentBoundary(text, index + 1)) continue;
			closingStart = slashStart;
			closingEnd = index + 1;
			break;
		}

		if (closingStart < 0) {
			output.push(text.slice(copiedThrough, valueStart), '[REDACTED]');
			copiedThrough = text.length;
			QUOTED_SECRET_PREFIX.lastIndex = text.length;
			continue;
		}

		output.push(
			text.slice(copiedThrough, valueStart),
			'[REDACTED]',
			text.slice(closingStart, closingEnd)
		);
		copiedThrough = closingEnd;
		QUOTED_SECRET_PREFIX.lastIndex = closingEnd;
	}

	QUOTED_SECRET_PREFIX.lastIndex = 0;
	return copiedThrough === 0 ? text : output.join('') + text.slice(copiedThrough);
}

export function redactSecrets(text: string): string {
	return redactQuotedAssignments(
		text
			.replace(PRIVATE_KEY_BLOCK, '[REDACTED PRIVATE KEY]')
			.replace(PRIVATE_KEY_TAIL, '[REDACTED PRIVATE KEY]')
	)
		.replace(AUTHORIZATION_HEADER, '$1[REDACTED]')
		.replace(SECRET_ASSIGNMENT, '$1[REDACTED]$3')
		.replace(BEARER, '$1[REDACTED]');
}

function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			isSecretKey(key) && typeof item === 'string' && item ? '[REDACTED]' : redactValue(item)
		])
	);
}

function redactValue(value: unknown): unknown {
	if (typeof value === 'string') return redactSecrets(value);
	if (Array.isArray(value)) return value.map(redactValue);
	if (typeof value === 'object' && value !== null) {
		return redactRecord(value as Record<string, unknown>);
	}
	return value;
}

function redactResult(result: ToolResult | null): ToolResult | null {
	return result ? { ...result, text: redactSecrets(result.text) } : null;
}

function redactDiff(diff: EditDiff): EditDiff {
	return {
		...diff,
		file: redactSecrets(diff.file),
		before: redactSecrets(diff.before),
		after: redactSecrets(diff.after)
	};
}

function redactTodo(todo: TodoPlan | undefined): TodoPlan | undefined {
	if (!todo) return undefined;
	return {
		...todo,
		activePhase: todo.activePhase ? redactSecrets(todo.activePhase) : null,
		phases: todo.phases.map((phase) => ({
			name: redactSecrets(phase.name),
			items: phase.items.map((item) => ({
				...item,
				content: redactSecrets(item.content),
				...(item.note ? { note: redactSecrets(item.note) } : {})
			}))
		}))
	};
}

function redactBlock(block: Block): Block {
	switch (block.kind) {
		case 'text':
		case 'thinking':
			return { ...block, text: redactSecrets(block.text) };
		case 'tool':
			return {
				...block,
				summary: redactSecrets(block.summary),
				input: block.input ? redactRecord(block.input) : null,
				result: redactResult(block.result),
				diffs: block.diffs.map(redactDiff),
				todo: redactTodo(block.todo)
			};
		case 'image':
			return { ...block, caption: redactSecrets(block.caption) };
	}
}

function redactMessage(message: Message): Message {
	return {
		...message,
		text: redactSecrets(message.text),
		tools: message.tools.map((tool) => ({
			name: tool.name,
			summary: redactSecrets(tool.summary)
		})),
		...(message.blocks ? { blocks: message.blocks.map(redactBlock) } : {}),
		...(message.ask
			? {
					ask: {
						question: redactSecrets(message.ask.question),
						options: message.ask.options.map(redactSecrets)
					}
				}
			: {})
	};
}

/** Keep credentials out of Bordr even when a harness stored them in raw JSONL. */
export function withSecretRedaction(adapter: Adapter): Adapter {
	return {
		resolve: (sessionId) => adapter.resolve(sessionId),
		parse: (jsonl) => adapter.parse(jsonl).map(redactMessage)
	};
}
