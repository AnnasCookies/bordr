import { describe, expect, it } from 'vitest';
import { piScreenWorking, piTranscriptSettled, piStatusDiagnostic } from './pi-status';
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

it('busy pixels are positive evidence, absent pixels are not', () => {
	expect(piScreenWorking(WORKING_PI)).toBe(true);
	expect(piScreenWorking(IDLE_PI)).toBe(false);
	expect(piStatusDiagnostic('pi', 'working', true, true)).toBeUndefined();
	expect(piStatusDiagnostic('claude', 'working', false, true)).toBeUndefined();
});

describe('piTranscriptSettled', () => {
	it('requires a non-empty assistant reply at the transcript tail', () => {
		expect(piTranscriptSettled([message('user', 'do it')])).toBe(false);
		expect(piTranscriptSettled([message('assistant', '')])).toBe(false);
		expect(piTranscriptSettled([message('assistant', 'done')])).toBe(false);
		expect(piTranscriptSettled([{ ...message('assistant', 'done'), stopReason: 'stop' }])).toBe(
			true
		);
	});
});

it('keeps custom, missing and fallback busy screens operationally working', () => {
	for (const screen of ['', '── ⠹ Reviewing ──', 'Watch: Waiting', 'last assistant prose']) {
		expect(piScreenWorking(screen)).toBe(false);
	}
	const stopped = { ...message('assistant', 'done'), stopReason: 'stop' };
	expect(piStatusDiagnostic('pi', 'working', false, piTranscriptSettled([stopped]))).toContain(
		'unverified'
	);
	expect(
		piTranscriptSettled([
			{
				...stopped,
				blocks: [{ kind: 'tool', name: 'watch', summary: '', input: null, result: null, diffs: [] }]
			}
		])
	).toBe(false);
});
