import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSubagents, readSubagent, subagentsDir } from './subagents';

/** A session transcript with a subagents directory beside it, as Claude Code lays it out. */
function session(agents: { id: string; meta?: object; lines?: string[] }[]): string {
	const project = mkdtempSync(join(tmpdir(), 'bordr-sub-'));
	const id = 'sess-1';
	const transcript = join(project, `${id}.jsonl`);
	writeFileSync(transcript, '');
	const dir = join(project, id, 'subagents');
	mkdirSync(dir, { recursive: true });
	for (const a of agents) {
		if (a.meta) writeFileSync(join(dir, `${a.id}.meta.json`), JSON.stringify(a.meta));
		if (a.lines) writeFileSync(join(dir, `${a.id}.jsonl`), a.lines.join('\n'));
	}
	return transcript;
}

const entry = (at: string) => JSON.stringify({ type: 'assistant', timestamp: at });

describe('subagentsDir', () => {
	it('sits beside the session, named after it', () => {
		expect(subagentsDir('/p/sess-1.jsonl')).toBe('/p/sess-1/subagents');
	});
});

describe('listSubagents', () => {
	it('reads what each agent is and who asked for it', async () => {
		const t = session([
			{
				id: 'agent-aaa',
				meta: {
					agentType: 'Explore',
					description: 'Map ccd-review repo',
					toolUseId: 'toolu_01N5',
					spawnDepth: 1
				},
				lines: [entry('2026-09-12T17:10:55.955Z'), entry('2026-09-12T17:11:02.000Z')]
			}
		]);
		const [agent] = await listSubagents(t);
		expect(agent.agentType).toBe('Explore');
		expect(agent.description).toBe('Map ccd-review repo');
		expect(agent.toolUseId).toBe('toolu_01N5');
		expect(agent.entries).toBe(2);
		expect(agent.lastAt).toBe(Date.parse('2026-09-12T17:11:02.000Z'));
	});

	it('puts the most recently active first', async () => {
		const t = session([
			{ id: 'agent-old', meta: { agentType: 'a' }, lines: [entry('2026-09-12T10:00:00.000Z')] },
			{ id: 'agent-new', meta: { agentType: 'b' }, lines: [entry('2026-09-12T18:00:00.000Z')] }
		]);
		expect((await listSubagents(t)).map((a) => a.id)).toEqual(['agent-new', 'agent-old']);
	});

	it('skips a sidecar whose transcript has not appeared yet', async () => {
		// An agent you cannot open is worse than one you cannot see — it reads
		// as a fault in bordr rather than an agent that has not started.
		const t = session([{ id: 'agent-ghost', meta: { agentType: 'Explore' } }]);
		expect(await listSubagents(t)).toEqual([]);
	});

	it('survives a half-written final line, which is normal while one runs', async () => {
		const t = session([
			{
				id: 'agent-live',
				meta: { agentType: 'x' },
				lines: [entry('2026-09-12T12:00:00.000Z'), '{"partial']
			}
		]);
		const [agent] = await listSubagents(t);
		expect(agent.lastAt).toBe(Date.parse('2026-09-12T12:00:00.000Z'));
	});

	it('says nothing for a session that never spawned one', async () => {
		const project = mkdtempSync(join(tmpdir(), 'bordr-nosub-'));
		const t = join(project, 'sess-1.jsonl');
		writeFileSync(t, '');
		expect(await listSubagents(t)).toEqual([]);
	});
});

describe('readSubagent', () => {
	it('returns the transcript for a known agent', async () => {
		const t = session([
			{ id: 'agent-aaa', meta: { agentType: 'x' }, lines: [entry('2026-09-12T12:00:00.000Z')] }
		]);
		expect(await readSubagent(t, 'agent-aaa')).toContain('assistant');
	});

	it('refuses an id that could address anything but a sibling file', async () => {
		// The id lands in a path, so traversal has to be impossible by shape.
		const t = session([{ id: 'agent-aaa', meta: {}, lines: ['{}'] }]);
		for (const bad of ['../../../etc/passwd', 'agent-../x', '', 'agent-a/b', 'not-an-agent']) {
			expect(await readSubagent(t, bad), bad).toBeNull();
		}
	});
});
