import type { Block } from '$lib/server/transcript/types';
import { parseTodoPlan, type TodoPlan } from '$lib/todo-plan';

export type MessageSegment = {
	kind: 'prose' | 'work';
	blocks: Block[];
};

function segmentKind(block: Block): MessageSegment['kind'] {
	return block.kind === 'text' || block.kind === 'image' ? 'prose' : 'work';
}

/** What was said, for bubble visibility and run detection. */
export function proseBlocks(blocks: Block[] | undefined): Block[] {
	return (blocks ?? []).filter((block) => segmentKind(block) === 'prose');
}

/** Tool calls, results and thinking, which sit outside speech bubbles. */
export function workBlocks(blocks: Block[] | undefined): Block[] {
	return (blocks ?? []).filter((block) => segmentKind(block) === 'work');
}

/** The todo card carried by an OMP todo tool call, including old transcripts. */
export function todoPlanForBlock(block: Block): TodoPlan | null {
	if (block.kind !== 'tool' || block.name.toLowerCase() !== 'todo') return null;
	if (block.todo) return block.todo;
	if (!block.result) return null;
	return parseTodoPlan(block.result.text);
}

/** Todo cards are conversation state, not optional tool detail. */
export function hasTodoPlan(blocks: Block[] | undefined): boolean {
	return blocks?.some((block) => todoPlanForBlock(block) !== null) ?? false;
}

/**
 * Whether the work may be folded into a tool tally. Thinking is a message and
 * a todo is live conversation state, so neither may disappear inside a group.
 */
export function onlyToolWork(blocks: Block[] | undefined): boolean {
	let hasTool = false;
	for (const block of blocks ?? []) {
		if (segmentKind(block) === 'prose') continue;
		if (block.kind !== 'tool' || todoPlanForBlock(block) !== null) return false;
		hasTool = true;
	}
	return hasTool;
}

/**
 * Split a turn into adjacent prose/work runs without changing transcript order.
 * A final answer after thinking must stay after it, not jump above it merely
 * because prose and work use different shells in bubble mode.
 */
export function messageSegments(blocks: Block[] | undefined): MessageSegment[] {
	const segments: MessageSegment[] = [];
	for (const block of blocks ?? []) {
		const kind = segmentKind(block);
		const previous = segments.at(-1);
		if (previous?.kind === kind) {
			previous.blocks.push(block);
			continue;
		}
		segments.push({ kind, blocks: [block] });
	}
	return segments;
}
