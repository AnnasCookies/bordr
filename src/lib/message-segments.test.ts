import { describe, expect, it } from 'vitest';
import type { Block } from '$lib/server/transcript/types';
import {
	hasTodoPlan,
	messageSegments,
	onlyThinking,
	onlyToolWork,
	proseBlocks,
	todoPlanForBlock,
	workBlocks
} from './message-segments';

const thinking: Block = { kind: 'thinking', text: 'checking' };
const first: Block = { kind: 'text', text: 'before' };
const tool: Block = {
	kind: 'tool',
	name: 'Read',
	summary: 'state.ts',
	input: null,
	result: null,
	diffs: []
};
const last: Block = { kind: 'text', text: 'finished' };
const image: Block = { kind: 'image', src: '/api/uploads/example.png', caption: '' };
const todo: Block = {
	kind: 'tool',
	name: 'todo',
	summary: 'Viewing plan',
	input: null,
	result: {
		text: 'Overall: 0/1 done, 1 open.\nActive phase 1/1 "Work" (0/1).\n  Work:\n    - [ ] Keep visible',
		isError: false,
		truncatedLines: 0
	},
	diffs: []
};

describe('message segments', () => {
	it('keeps thinking and tools in their original place around prose', () => {
		expect(messageSegments([thinking, first, tool, last])).toEqual([
			{ kind: 'work', blocks: [thinking] },
			{ kind: 'prose', blocks: [first] },
			{ kind: 'work', blocks: [tool] },
			{ kind: 'prose', blocks: [last] }
		]);
	});

	it('keeps adjacent text and images in one speech bubble', () => {
		expect(messageSegments([first, image, last])).toEqual([
			{ kind: 'prose', blocks: [first, image, last] }
		]);
		expect(proseBlocks([thinking, first, image])).toEqual([first, image]);
		expect(workBlocks([thinking, first, tool])).toEqual([thinking, tool]);
	});

	it('does not group thinking or todo cards with tool-only work', () => {
		expect(onlyToolWork([tool])).toBe(true);
		expect(onlyToolWork([thinking, tool])).toBe(false);
		expect(onlyToolWork([thinking])).toBe(false);
		expect(onlyToolWork([todo])).toBe(false);
		expect(hasTodoPlan([todo])).toBe(true);
		expect(todoPlanForBlock(todo)?.phases[0].items[0].content).toBe('Keep visible');
	});

	it('joins only turns made entirely from thinking', () => {
		expect(onlyThinking([thinking])).toBe(true);
		expect(onlyThinking([thinking, { ...thinking, text: 'again' }])).toBe(true);
		expect(onlyThinking([thinking, tool])).toBe(false);
		expect(onlyThinking([])).toBe(false);
		expect(onlyThinking(undefined)).toBe(false);
	});
});
