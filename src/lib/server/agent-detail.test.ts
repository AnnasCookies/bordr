import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentDetail } from '$lib/types';

const fixture = vi.hoisted(() => ({
	raw: {} as Record<string, unknown>,
	visible: '',
	tail: '',
	head: ''
}));
vi.mock('$lib/server/herdr', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/herdr')>()),
	rawAgent: async () => fixture.raw,
	rawPane: async () => fixture.raw,
	rawAgents: async () => [fixture.raw],
	readVisible: async () => fixture.visible,
	readPane: async () => fixture.visible
}));
vi.mock('$lib/server/herdr/branches', () => ({ branchesFor: async () => new Map() }));
vi.mock('$lib/server/herdr/pulls', () => ({ pullFor: () => null }));
vi.mock('$lib/server/herdr/connections', () => ({
	connectionFor: () => null,
	ensureConnection: async () => ({ machine: { id: 'remote', label: 'Fixture' } }),
	remoteTranscriptTail: async (
		_machine: unknown,
		_agent: string,
		_session: string,
		_bytes: number,
		head = false
	) => (head ? fixture.head : fixture.tail)
}));
import { GET } from '../../routes/api/agents/[pane]/+server';
import { toSummary } from '$lib/server/herdr';
import { enrichAgents } from './enrich';

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function read(pane = 'fixture'): Promise<AgentDetail> {
	const response = await GET({
		params: { pane },
		url: new URL('http://localhost/api/agents/fixture?bytes=1024')
	} as Parameters<typeof GET>[0]);
	return response.json();
}
async function local(agent: string, text: string) {
	const dir = await mkdtemp(join(tmpdir(), 'bordr-detail-'));
	dirs.push(dir);
	const path = join(dir, 'session.jsonl');
	await writeFile(path, text);
	fixture.raw = {
		pane_id: 'fixture',
		agent,
		agent_status: 'working',
		cwd: '/pane',
		agent_session: { value: path },
		state_change_seq: Date.now()
	};
	fixture.visible = '── ⠹ Reviewing ──\ncustom footer';
}

it('recovers header cwd and middle model switches without changing active lifecycle', async () => {
	const record = (modelId: string) => JSON.stringify({ type: 'model_change', modelId }) + '\n';
	const padding = '{"type":"custom"}\n'.repeat(3000);
	await local(
		'pi',
		'{"type":"session","cwd":"/agent"}\n' + record('opening') + padding + record('middle') + padding
	);
	const detail = await read();
	expect(detail.cwd).toBe('/agent');
	expect(detail.model).toBe('middle');
	expect(detail.status).toBe('working');
	expect(detail.paneCwd).toBe('/pane');
});
it('applies queue redaction locally and remotely; remote missing model stays unknown', async () => {
	const queue = JSON.stringify({
		type: 'queue-operation',
		operation: 'enqueue',
		content: 'TOKEN=fixture-secret',
		timestamp: new Date().toISOString()
	});
	await local('claude', queue);
	expect(JSON.stringify((await read()).queue)).not.toContain('fixture-secret');
	fixture.raw.pane_id = 'remote~fixture';
	fixture.tail = queue;
	fixture.head = '{"cwd":"/remote-agent"}\n';
	const detail = await read('remote~fixture');
	expect(detail.cwd).toBe('/remote-agent');
	expect(detail.model).toBe('');
	expect(JSON.stringify(detail.queue)).not.toContain('fixture-secret');
});
it('preserves lifecycle on degraded snapshots and suppresses non-live OMP asks in detail and list', async () => {
	const ask = JSON.stringify({
		type: 'message',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'toolCall',
					id: 'ask',
					name: 'ask',
					arguments: { questions: [{ question: 'Choose', options: ['one', 'two'] }] }
				}
			]
		}
	});
	await local('omp', ask);
	expect((await read()).picker).toBeNull();
	const [summary] = await enrichAgents([toSummary(fixture.raw)]);
	expect(summary.picker).toBeNull();
	expect(summary.status).toBe('working');
	fixture.raw.agent = 'unsupported';
	const fallback = await read();
	expect(fallback.degraded).toBe('no-adapter');
	expect(fallback.status).toBe('working');
	expect(fallback.statusDiagnostic).toBeUndefined();
});
