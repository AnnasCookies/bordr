import { describe, expect, it } from 'vitest';
import { agentCwd } from './cwd';

const line = (o: unknown) => JSON.stringify(o);

describe('agentCwd', () => {
	it('takes the newest top-level cwd, so a mid-session cd wins', () => {
		// Claude Code stamps every line, so the last one is where the agent is now.
		const jsonl = [
			line({ type: 'user', cwd: '/home/tony' }),
			line({ type: 'assistant', cwd: '/home/tony/bordr' })
		].join('\n');
		expect(agentCwd(jsonl)).toBe('/home/tony/bordr');
	});

	it('reads payload.cwd, which is where Codex puts it', () => {
		expect(agentCwd(line({ type: 'session_meta', payload: { cwd: '/home/tony/repos' } }))).toBe(
			'/home/tony/repos'
		);
	});

	it('finds a cwd stated once at the top, as omp states it', () => {
		const jsonl = [
			line({ type: 'meta', cwd: '/home/tony/omp' }),
			line({ type: 'message', id: 'a' }),
			line({ type: 'message', id: 'b' })
		].join('\n');
		expect(agentCwd(jsonl)).toBe('/home/tony/omp');
	});

	it('ignores a cwd quoted inside tool output', () => {
		// The trap this function exists to avoid: a transcript whose tool output
		// contains the word cwd is not the harness stating a directory. A regex
		// over the raw text would return /wrong/place here.
		const jsonl = [
			line({ type: 'user', cwd: '/home/tony/bordr' }),
			line({
				type: 'assistant',
				message: { content: [{ type: 'text', text: '{"cwd":"/wrong/place"}' }] }
			})
		].join('\n');
		expect(agentCwd(jsonl)).toBe('/home/tony/bordr');
	});

	it('skips the half line a tail window starts on', () => {
		const jsonl = ['e":"assistant"}', line({ type: 'user', cwd: '/home/tony' })].join('\n');
		expect(agentCwd(jsonl)).toBe('/home/tony');
	});

	it('is empty when nothing says, so the caller can fall back', () => {
		expect(agentCwd('')).toBe('');
		expect(agentCwd(line({ type: 'user' }))).toBe('');
		expect(agentCwd(line({ type: 'user', cwd: 42 }))).toBe('');
	});
});

it('ignores a sidechain worktree when selecting the parent cwd', () => {
	expect(
		agentCwd(
			[{ cwd: '/parent-repo' }, { cwd: '/child-repo', isSidechain: true }].map(line).join('\n')
		)
	).toBe('/parent-repo');
});
