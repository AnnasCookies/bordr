export interface ToolCall {
	name: string;
	summary: string;
}

export interface ToolResult {
	text: string;
	/** The harness marked the result an error — worth colouring, not hiding. */
	isError: boolean;
	/** Lines dropped from the end, so the view can say how many rather than lie. */
	truncatedLines: number;
}

/** An in-place edit, kept as its two sides so the view can diff them. */
export interface EditDiff {
	file: string;
	before: string;
	after: string;
}

/**
 * One piece of a turn, in transcript order.
 *
 * Ordered, because a turn genuinely is: prose, a tool call, its result, more
 * prose. The flat `{text, tools[]}` shape below cannot express that — it was
 * why results, diffs and thinking had nowhere to go.
 *
 * `kind` rather than `type`: every harness's own on-disk blocks use `type`,
 * and having both meant constantly asking which one a variable held.
 */
export type Block =
	| { kind: 'text'; text: string }
	| { kind: 'thinking'; text: string }
	| {
			kind: 'tool';
			name: string;
			/** One line: the argument that identifies the call. `Read(projector.ts)`. */
			summary: string;
			/**
			 * The call's arguments, as the harness recorded them. Kept as an
			 * object rather than pre-stringified JSON so the view can render
			 * each tool the way a terminal shows it — a Bash call as a command,
			 * a Write as its contents — and fall back to JSON on request.
			 */
			input: Record<string, unknown> | null;
			result: ToolResult | null;
			diff: EditDiff | null;
	  }
	| { kind: 'image'; src: string; caption: string };

export interface Message {
	role: 'user' | 'assistant' | 'system';
	/**
	 * Text of the turn, flattened. Derived from `blocks` for adapters that
	 * emit them. Kept because the preview, search and picker all read it, and
	 * none of them wants block structure.
	 */
	text: string;
	tools: ToolCall[];
	/**
	 * The turn in order. Optional: adapters that have not been migrated are
	 * backfilled from `text`/`tools` by `adapterFor`, so the view only ever
	 * handles this one shape.
	 */
	blocks?: Block[];
	/**
	 * A question the harness asked through a tool rather than a dialog
	 * (codex's request_user_input): the phone answers it by typing the
	 * option back, so the options travel with the message.
	 */
	ask?: { question: string; options: string[] };
}

export interface Adapter {
	/** Absolute path to the transcript for this session id, or null if absent. */
	resolve(sessionId: string): Promise<string | null>;
	parse(jsonl: string): Message[];
}

/** The flat text a block list reduces to, for preview/search/picker. */
export function flattenBlocks(blocks: Block[]): string {
	return blocks
		.filter((b) => b.kind === 'text')
		.map((b) => (b as { text: string }).text)
		.join('\n\n');
}

/** The flat tool list a block list reduces to. */
export function flattenTools(blocks: Block[]): ToolCall[] {
	return blocks
		.filter((b) => b.kind === 'tool')
		.map((b) => {
			const tool = b as { name: string; summary: string };
			return { name: tool.name, summary: tool.summary };
		});
}

/** Build a Message from blocks, deriving the flat fields exactly once. */
export function fromBlocks(role: Message['role'], blocks: Block[], ask?: Message['ask']): Message {
	return {
		role,
		text: flattenBlocks(blocks),
		tools: flattenTools(blocks),
		blocks,
		...(ask ? { ask } : {})
	};
}

/** Blocks for a message an adapter built the old way. One code path in the view. */
export function backfillBlocks(message: Message): Message {
	if (message.blocks) return message;
	const blocks: Block[] = [];
	if (message.text) blocks.push({ kind: 'text', text: message.text });
	for (const tool of message.tools) {
		blocks.push({
			kind: 'tool',
			name: tool.name,
			summary: tool.summary,
			input: null,
			result: null,
			diff: null
		});
	}
	return { ...message, blocks };
}
