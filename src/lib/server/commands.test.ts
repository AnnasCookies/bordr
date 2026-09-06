import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rankCommands, type SlashCommand } from '$lib/commands';

/** A home directory laid out the way the harnesses lay theirs out. */
const HOME = mkdtempSync(join(tmpdir(), 'bordr-test-commands-'));
vi.mock('node:os', async (importOriginal) => {
	const original = await importOriginal<typeof import('node:os')>();
	return { ...original, homedir: () => HOME };
});

function file(path: string, content: string): void {
	mkdirSync(join(HOME, path, '..'), { recursive: true });
	writeFileSync(join(HOME, path), content);
}

// Claude Code: a user skill (quoted description), a user command (bare), a
// project skill, and a plugin with one skill and one command.
file(
	'.claude/skills/herdr/SKILL.md',
	'---\nname: herdr\ndescription: "Drive herdr: workspaces, panes, agents. Use when the user says \\"herdr\\"."\n---\n# Herdr\n'
);
file(
	'.claude/commands/compose.md',
	'---\ndescription: Full pipeline from brief to PR\n---\n# Compose\n'
);
file(
	'project/.claude/skills/local-only/SKILL.md',
	'---\nname: local-only\ndescription: >\n  A skill that lives in\n  the project.\n---\n'
);
file(
	'.claude/plugins/cache/official/superpowers/1.0.0/skills/brainstorming/SKILL.md',
	'---\nname: brainstorming\ndescription: Explore before building\n---\n'
);
file(
	'.claude/plugins/cache/official/superpowers/1.0.0/commands/write-plan.md',
	'---\ndescription: Write a plan\n---\n'
);
file(
	'.claude/plugins/installed_plugins.json',
	JSON.stringify({
		version: 2,
		plugins: {
			'superpowers@official': [
				{ installPath: join(HOME, '.claude/plugins/cache/official/superpowers/1.0.0') }
			]
		}
	})
);
// pi: a cross-harness skill, an npm package with a skill and a prompt.
file(
	'.agents/skills/auditing-a-code-review/SKILL.md',
	"---\nname: auditing-a-code-review\ndescription: 'Check a review'\n---\n"
);
file(
	'.pi/agent/npm/node_modules/bigpowers/skills/deploy/SKILL.md',
	'---\ndescription: Build then deploy\n---\n'
);
file(
	'.pi/agent/npm/node_modules/@scope/pkg/prompts/review-loop.md',
	'---\ndescription: Review until clean\n---\n'
);
// agy: its own dir.
file(
	'.gemini/antigravity-cli/skills/dockerize/SKILL.md',
	'---\ndescription: Bootstrap Traefik\n---\n'
);

afterAll(() => rmSync(HOME, { recursive: true, force: true }));

async function load() {
	const mod = await import('./commands');
	mod.resetCommandCache();
	return mod;
}

beforeEach(() => {
	vi.resetModules();
});

const names = (list: SlashCommand[]) => list.map((c) => c.name);

describe('commandsFor: Claude Code', () => {
	it('lists built-ins first, then skills, commands, project skills and plugins as /plugin:name', async () => {
		const { commandsFor } = await load();
		const list = await commandsFor('claude', join(HOME, 'project'));
		expect(names(list).slice(0, 2)).toEqual(['add-dir', 'advisor']);
		expect(list.find((c) => c.name === 'herdr')).toEqual({
			name: 'herdr',
			description: 'Drive herdr: workspaces, panes, agents. Use when the user says "herdr".',
			source: 'skill'
		});
		expect(list.find((c) => c.name === 'compose')).toMatchObject({
			description: 'Full pipeline from brief to PR',
			source: 'command'
		});
		expect(list.find((c) => c.name === 'local-only')?.description).toBe(
			'A skill that lives in the project.'
		);
		expect(list.find((c) => c.name === 'superpowers:brainstorming')).toEqual({
			name: 'superpowers:brainstorming',
			description: '(superpowers) Explore before building',
			source: 'plugin'
		});
		expect(list.find((c) => c.name === 'superpowers:write-plan')?.source).toBe('plugin');
	});

	it('keeps a built-in over an installed command of the same name, and names each once', async () => {
		const { commandsFor } = await load();
		const list = await commandsFor('claude', join(HOME, 'project'));
		const model = list.filter((c) => c.name === 'model');
		expect(model).toHaveLength(1);
		expect(model[0].source).toBe('builtin');
		expect(new Set(names(list)).size).toBe(list.length);
	});
});

describe('commandsFor: pi and agy', () => {
	it('spells cross-harness skills /skill:name for pi and reads npm skills and prompts', async () => {
		const { commandsFor } = await load();
		const list = await commandsFor('pi', '/tmp');
		expect(names(list).slice(0, 3)).toEqual(['settings', 'model', 'tree']);
		expect(list.find((c) => c.name === 'skill:auditing-a-code-review')?.description).toBe(
			'Check a review'
		);
		expect(list.find((c) => c.name === 'deploy')).toMatchObject({
			description: 'Build then deploy',
			source: 'skill'
		});
		expect(list.find((c) => c.name === 'review-loop')).toMatchObject({
			description: 'Review until clean',
			source: 'prompt'
		});
	});

	it("reads agy's own skills dir and nothing else", async () => {
		const { commandsFor } = await load();
		const list = await commandsFor('agy', '/tmp');
		expect(list.find((c) => c.name === 'dockerize')?.description).toBe('Bootstrap Traefik');
		expect(list.find((c) => c.name === 'skill:auditing-a-code-review')).toBeUndefined();
	});

	it('gives an unknown harness nothing rather than an error', async () => {
		const { commandsFor } = await load();
		expect(await commandsFor('mystery', '/tmp')).toEqual([]);
	});
});

describe('parseDescription', () => {
	it('reads bare, quoted and block descriptions, and nothing without front matter', async () => {
		const { parseDescription } = await load();
		expect(parseDescription('---\ndescription: plain words\n---\n')).toBe('plain words');
		expect(parseDescription("---\nname: x\ndescription: 'single quoted'\n---\n")).toBe(
			'single quoted'
		);
		expect(parseDescription('---\ndescription: |\n  line one\n  line two\n---\n')).toBe(
			'line one line two'
		);
		expect(parseDescription('# No front matter\ndescription: nope\n')).toBe('');
		expect(parseDescription(`---\ndescription: ${'x'.repeat(300)}\n---\n`)).toHaveLength(200);
	});
});

describe('rankCommands', () => {
	const list: SlashCommand[] = [
		{ name: 'compact', description: 'Free up context', source: 'builtin' },
		{ name: 'model', description: 'Set the AI model', source: 'builtin' },
		{ name: 'output-style', description: 'Change the output style', source: 'builtin' },
		{ name: 'scoped-models', description: 'Enable models for cycling', source: 'builtin' },
		{ name: 'superpowers:brainstorming', description: 'Explore before building', source: 'plugin' }
	];

	it('puts name prefixes first, then name substrings, then description matches', () => {
		expect(rankCommands(list, '/mod').map((c) => c.name)).toEqual(['model', 'scoped-models']);
		expect(
			rankCommands(
				[
					{ name: 'mobile', description: '', source: 'builtin' },
					{ name: 'model', description: '', source: 'builtin' }
				],
				'/mo'
			).map((c) => c.name)
		).toEqual(['model', 'mobile']);
		expect(rankCommands(list, '/context').map((c) => c.name)).toEqual(['compact']);
		expect(rankCommands(list, '/').map((c) => c.name)).toEqual(names(list));
		expect(rankCommands(list, '/zzz')).toEqual([]);
	});

	it('caps the list', () => {
		expect(rankCommands(list, '/', 2)).toHaveLength(2);
	});
});
