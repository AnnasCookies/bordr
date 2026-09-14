import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { todoPlanFromDetails } from '$lib/todo-plan';
import {
	fromBlocks,
	type Adapter,
	type Block,
	type EditDiff,
	type Message,
	type ToolResult
} from './types';

interface ContentBlock {
	type?: string;
	text?: string;
	thinking?: string;
	name?: string;
	id?: string;
	intent?: string;
	arguments?: unknown;
	data?: string;
	mimeType?: string;
}

interface OmpMessage {
	role?: string;
	content?: string | ContentBlock[];
	toolCallId?: string;
	isError?: boolean;
	timestamp?: number;
	details?: unknown;
}

interface Entry {
	type?: string;
	timestamp?: string;
	message?: OmpMessage;
}

const MAX_RESULT_LINES = 40;
const SUMMARY_CHARS = 72;
const MAX_IMAGE_BYTES = 1_100_000;
const MAX_IMAGES_BYTES = 4_500_000;
const BLOB_REFERENCE = /^blob:sha256:([a-f0-9]{64})$/;
const IMAGE_MEDIA = /^image\/(?:avif|gif|jpeg|png|webp)$/;
const OMP_BLOB_DIR = join(homedir(), '.omp', 'agent', 'blobs');

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function str(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function clip(value: string): string {
	const line = value.replace(/\s+/g, ' ').trim();
	return line.length > SUMMARY_CHARS ? `${line.slice(0, SUMMARY_CHARS - 1)}…` : line;
}

/** The first useful line beside an OMP tool name. */
export function piToolSummary(block: ContentBlock, input: Record<string, unknown> | null): string {
	const args = input ?? {};
	if (block.name === 'edit') {
		const patch = str(args.input);
		const file = /^\[([^#\]\n]+)#[0-9A-F]+\]$/m.exec(patch)?.[1];
		if (file) return clip(file);
	}
	for (const value of [
		block.intent,
		args.i,
		args.title,
		args.description,
		args.command,
		args.path,
		args.file_path,
		args.query,
		args.pattern
	]) {
		const text = str(value);
		if (text) return clip(text);
	}
	for (const value of Object.values(args)) {
		if (typeof value === 'string' && value.length > 0 && value.length <= 120) return clip(value);
	}
	return '';
}

function resultText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((part) => (record(part)?.type === 'text' ? str(record(part)?.text) : ''))
		.filter(Boolean)
		.join('\n');
}

/**
 * Resolve OMP's content-addressed image blocks from its canonical blob store.
 *
 * Only a bare SHA-256 reference is accepted. The joined path therefore cannot
 * leave the blob directory, and symlinks are rejected before any bytes are
 * read. The caller shares one byte budget across the full transcript parse,
 * so repeated detail polling has a fixed response ceiling rather than one cap
 * per tool result.
 */
export function ompResultImages(
	content: unknown,
	blobDir = OMP_BLOB_DIR,
	budget: { remaining: number } = { remaining: MAX_IMAGES_BYTES }
): { images: string[]; dropped: number } {
	if (!Array.isArray(content)) return { images: [], dropped: 0 };
	const images: string[] = [];
	let dropped = 0;
	budget.remaining = Math.min(budget.remaining, MAX_IMAGES_BYTES);
	for (const part of content) {
		const block = record(part);
		if (block?.type !== 'image') continue;
		const reference = str(block.data);
		const media = str(block.mimeType);
		const hash = BLOB_REFERENCE.exec(reference)?.[1];
		if (!hash || !IMAGE_MEDIA.test(media)) continue;
		const path = join(blobDir, hash);
		let descriptor: number | undefined;
		try {
			descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
			const metadata = fstatSync(descriptor);
			if (!metadata.isFile()) continue;
			if (metadata.size > MAX_IMAGE_BYTES || metadata.size > budget.remaining) {
				dropped++;
				continue;
			}
			const bytes = readFileSync(descriptor);
			if (bytes.length > MAX_IMAGE_BYTES || bytes.length > budget.remaining) {
				dropped++;
				continue;
			}
			budget.remaining -= bytes.length;
			images.push(`data:${media};base64,${bytes.toString('base64')}`);
		} catch {
			// A missing, linked or unreadable blob leaves the text result intact.
		} finally {
			if (descriptor !== undefined) closeSync(descriptor);
		}
	}
	return { images, dropped };
}

function toResult(message: OmpMessage, imageBudget: { remaining: number }): ToolResult {
	const full = resultText(message.content).replace(/\s+$/, '');
	const lines = full ? full.split('\n') : [];
	const kept = lines.slice(0, MAX_RESULT_LINES);
	const { images, dropped } = ompResultImages(message.content, OMP_BLOB_DIR, imageBudget);
	return {
		text: kept.join('\n'),
		isError: message.isError === true,
		truncatedLines: Math.max(0, lines.length - kept.length),
		...(images.length > 0 && { images }),
		...(dropped > 0 && { imagesDropped: dropped })
	};
}
function editDiff(path: unknown, diff: unknown): EditDiff | null {
	const file = str(path);
	const before: string[] = [];
	const after: string[] = [];
	for (const line of str(diff).split('\n')) {
		if (line[0] !== '-' && line[0] !== '+') continue;
		const separator = line.indexOf('|');
		if (separator < 0) continue;
		(line[0] === '-' ? before : after).push(line.slice(separator + 1));
	}
	return file && (before.length > 0 || after.length > 0)
		? { file, before: before.join('\n'), after: after.join('\n') }
		: null;
}

function ompEditDiffs(details: unknown): EditDiff[] {
	const value = record(details);
	if (!value) return [];
	if (Array.isArray(value.perFileResults)) {
		const diffs = value.perFileResults
			.map((result) => {
				const file = record(result);
				return file ? editDiff(file.path, file.diff) : null;
			})
			.filter((diff): diff is EditDiff => diff !== null);
		if (diffs.length > 0) return diffs;
	}
	const diff = editDiff(value.path, value.diff);
	return diff ? [diff] : [];
}

function askedQuestion(input: Record<string, unknown> | null): Message['ask'] | undefined {
	const questions = input?.questions;
	if (!Array.isArray(questions) || questions.length === 0) return undefined;
	const first = record(questions[0]);
	const question = str(first?.question);
	const rawOptions = first?.options;
	if (!question || !Array.isArray(rawOptions)) return undefined;
	const options = rawOptions
		.map((option) => (typeof option === 'string' ? option : str(record(option)?.label)))
		.filter(Boolean);
	return options.length > 0 ? { question, options } : undefined;
}

function timestamp(entry: Entry): number {
	if (typeof entry.message?.timestamp === 'number') return entry.message.timestamp;
	return entry.timestamp ? Date.parse(entry.timestamp) || 0 : 0;
}

/** True when OMP's reported transcript belongs to a session that has shut down. */
export function piSessionEnded(jsonl: string): boolean {
	const lines = jsonl.split('\n');
	for (let index = lines.length - 1; index >= 0; index--) {
		const line = lines[index];
		if (!line?.trim()) continue;
		try {
			const entry = record(JSON.parse(line));
			if (!entry) continue;
			if (entry.type === 'custom' && entry.customType === 'session_exit') return true;
			if (entry.type === 'message') return false;
		} catch {
			continue;
		}
	}
	return false;
}

/**
 * pi and omp share one session format (omp is a pi fork): conversation blocks
 * sit in assistant/user messages, while a later toolResult message points back
 * to its toolCall by id.
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
		const pending = new Map<string, Block>();
		const asked: Array<{ at: number; tool: Block }> = [];
		const imageBudget = { remaining: MAX_IMAGES_BYTES };

		for (const line of jsonl.split('\n')) {
			if (!line.trim()) continue;

			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				continue;
			}
			const raw = record(parsed);
			if (!raw || raw.type !== 'message') continue;
			const entry = raw as Entry;
			const message = entry.message;
			if (!message) continue;

			if (message.role === 'toolResult') {
				const tool = message.toolCallId ? pending.get(message.toolCallId) : undefined;
				if (tool?.kind === 'tool') {
					tool.result = toResult(message, imageBudget);
					if (tool.name.toLowerCase() === 'edit') tool.diffs = ompEditDiffs(message.details);
					if (tool.name.toLowerCase() === 'todo') {
						const todo = todoPlanFromDetails(message.details);
						if (todo) tool.todo = todo;
					}
					pending.delete(message.toolCallId as string);
				}
				continue;
			}

			if (message.role !== 'user' && message.role !== 'assistant') continue;
			const role = message.role;
			const at = timestamp(entry);
			if (typeof message.content === 'string') {
				if (message.content.trim()) {
					messages.push(fromBlocks(role, [{ kind: 'text', text: message.content }], undefined, at));
				}
				continue;
			}
			if (!Array.isArray(message.content)) continue;

			const blocks: Block[] = [];
			let ask: Message['ask'] | undefined;
			for (const block of message.content) {
				if (block.type === 'text' && block.text) {
					blocks.push({ kind: 'text', text: block.text });
				} else if (block.type === 'thinking' && block.thinking) {
					blocks.push({ kind: 'thinking', text: block.thinking });
				} else if (block.type === 'toolCall' && block.name) {
					const input =
						typeof block.arguments === 'string'
							? { input: block.arguments }
							: record(block.arguments);
					const tool: Block = {
						kind: 'tool',
						name: block.name,
						summary: piToolSummary(block, input),
						input,
						result: null,
						diffs: []
					};
					blocks.push(tool);
					if (block.id) pending.set(block.id, tool);
					if (block.name === 'ask') {
						ask = askedQuestion(input);
						if (ask) asked.push({ at: messages.length, tool });
					}
				}
			}
			if (blocks.length === 0) continue;
			messages.push(fromBlocks(role, blocks, ask, at));
		}

		for (const { at, tool } of asked) {
			if (tool.kind === 'tool' && tool.result !== null) delete messages[at]?.ask;
		}
		return messages;
	}
};
