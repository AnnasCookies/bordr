import { describe, expect, it } from 'vitest';
import { piScreenWorking, piTranscriptSettled, reconcilePiStatus } from './pi-status';
import type { Message } from './transcript/types';

const message = (role: Message['role'], text: string): Message => ({ role, text, tools: [] });

const IDLE_PI = [
	'Finished the requested change.',
	'────────────────────────────────────────────────────────',
	'────────────────────────────────────────────────────────'
].join('\n');
const WORKING_PI = [
	'$ bun test',
	'── ⠹ Working ───────────────────────────────────────────',
	'────────────────────────────────────────────────────────'
].join('\n');

describe('reconcilePiStatus', () => {
	it('repairs a stale Pi working status after its final reply', () => {
		expect(reconcilePiStatus('pi', 'working', piScreenWorking(IDLE_PI), true)).toBe('idle');
	});

	it('keeps real Pi work working', () => {
		expect(reconcilePiStatus('pi', 'working', piScreenWorking(WORKING_PI), true)).toBe('working');
	});

	it('does not guess before a final assistant reply or for another harness', () => {
		expect(reconcilePiStatus('pi', 'working', piScreenWorking(IDLE_PI), false)).toBe('working');
		expect(reconcilePiStatus('claude', 'working', piScreenWorking(IDLE_PI), true)).toBe('working');
	});
});

describe('piTranscriptSettled', () => {
	it('requires a non-empty assistant reply at the transcript tail', () => {
		expect(piTranscriptSettled([message('user', 'do it')])).toBe(false);
		expect(piTranscriptSettled([message('assistant', '')])).toBe(false);
		expect(piTranscriptSettled([message('assistant', 'done')])).toBe(true);
	});
});
