import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_COMMANDS } from './commands-builtin';
import type { SlashCommand } from '$lib/commands';

export type { SlashCommand } from '$lib/commands';

/**
 * What the composer offers when the person types `/`.
 *
 * The harness's own popup never reaches the phone — bordr sends a message
 * whole, so the harness sees `/model⏎`, never `/mo` — and so bordr keeps
 * its own list: the harness's built-in commands (commands-builtin.ts, taken
 * from each popup) plus whatever the person installed, read off disk the
 * way the harness reads it. Every harness spells that differently:
 *
 *   Claude Code   ~/.claude/skills/<n>/SKILL.md, ~/.claude/commands/<n>.md,
 *                 the same two under the project's .claude/, and installed
 *                 plugins as /<plugin>:<n>
 *   pi, omp       ~/.agents/skills as /skill:<n>; their own skills and
 *                 prompts dirs; npm packages' skills/ and prompts/ as /<n>
 *   agy           its own skills dir as /<n>
 *   grok, copilot their own dir and ~/.agents/skills as /<n>
 *   codex         built-ins only (its skills are not slash commands)
 */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: SlashCommand[] }>();

/** For tests: forget every scan. */
export function resetCommandCache(): void {
	cache.clear();
}

export async function commandsFor(agent: string, cwd: string): Promise<SlashCommand[]> {
	const key = `${agent}\0${cwd}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

	const builtin = (BUILTIN_COMMANDS[agent] ?? []).map<SlashCommand>(([name, description]) => ({
		name,
		description,
		source: 'builtin'
	}));
	const installed = await discover(agent, cwd);
	// Built-ins first, then the person's own, each name once: a skill that
	// shadows a built-in keeps the built-in's row (that is what the harness
	// runs).
	const seen = new Set<string>();
	const value: SlashCommand[] = [];
	for (const command of [...builtin, ...installed]) {
		if (seen.has(command.name)) continue;
		seen.add(command.name);
		value.push(command);
	}
	cache.set(key, { at: Date.now(), value });
	return value;
}

const HOME = () => homedir();
const AGENTS_SKILLS = () => join(HOME(), '.agents', 'skills');

async function discover(agent: string, cwd: string): Promise<SlashCommand[]> {
	switch (agent) {
		case 'claude': {
			const configDir = process.env.CLAUDE_CONFIG_DIR || join(HOME(), '.claude');
			return flatten([
				skills(join(configDir, 'skills')),
				commands(join(configDir, 'commands')),
				skills(join(cwd, '.claude', 'skills')),
				commands(join(cwd, '.claude', 'commands')),
				plugins(join(configDir, 'plugins', 'installed_plugins.json'))
			]);
		}
		case 'pi':
		case 'omp': {
			const own = join(HOME(), agent === 'pi' ? '.pi' : '.omp', 'agent');
			return flatten([
				skills(AGENTS_SKILLS(), 'skill:'),
				skills(join(own, 'skills'), 'skill:'),
				skills(join(own, 'managed-skills'), 'skill:'),
				prompts(join(own, 'prompts')),
				npmPackages(join(own, 'npm', 'node_modules'))
			]);
		}
		case 'agy':
			return flatten([skills(join(HOME(), '.gemini', 'antigravity-cli', 'skills'))]);
		case 'grok':
			return flatten([skills(join(HOME(), '.grok', 'skills')), skills(AGENTS_SKILLS())]);
		case 'copilot':
			return flatten([skills(join(HOME(), '.copilot', 'skills')), skills(AGENTS_SKILLS())]);
		default:
			return [];
	}
}

async function flatten(parts: Array<Promise<SlashCommand[]>>): Promise<SlashCommand[]> {
	const settled = await Promise.allSettled(parts);
	return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []));
}

/** `<dir>/<name>/SKILL.md` → /<prefix><name>. */
async function skills(dir: string, prefix = ''): Promise<SlashCommand[]> {
	const out: SlashCommand[] = [];
	for (const name of await namesIn(dir)) {
		const file = join(dir, name, 'SKILL.md');
		const meta = await frontmatter(file);
		if (!meta) continue;
		out.push({ name: `${prefix}${name}`, description: meta.description, source: 'skill' });
	}
	return out;
}

/** `<dir>/<name>.md` → /<name>. */
async function commands(dir: string, source: SlashCommand['source'] = 'command') {
	const out: SlashCommand[] = [];
	for (const entry of await namesIn(dir)) {
		if (!entry.endsWith('.md')) continue;
		const meta = await frontmatter(join(dir, entry));
		out.push({ name: entry.slice(0, -3), description: meta?.description ?? '', source });
	}
	return out;
}

const prompts = (dir: string) => commands(dir, 'prompt');

/**
 * Claude Code's plugin registry: `{ plugins: { "<name>@<marketplace>":
 * [{ installPath }] } }`. Each plugin's skills and commands run as
 * /<plugin>:<name>, and Claude prefixes their descriptions with the plugin.
 */
async function plugins(registry: string): Promise<SlashCommand[]> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(registry, 'utf8'));
	} catch {
		return [];
	}
	const table =
		typeof parsed === 'object' && parsed !== null && 'plugins' in parsed
			? (parsed as { plugins: unknown }).plugins
			: parsed;
	if (typeof table !== 'object' || table === null) return [];

	const out: SlashCommand[] = [];
	for (const [key, entry] of Object.entries(table as Record<string, unknown>)) {
		const plugin = key.split('@')[0];
		const installs = Array.isArray(entry) ? entry : [entry];
		for (const install of installs) {
			const path =
				typeof install === 'object' && install !== null && 'installPath' in install
					? String((install as { installPath: unknown }).installPath)
					: '';
			if (!path) continue;
			for (const found of await flatten([
				skills(join(path, 'skills')),
				commands(join(path, 'commands'))
			])) {
				out.push({
					name: `${plugin}:${found.name}`,
					description: `(${plugin}) ${found.description}`.trim(),
					source: 'plugin'
				});
			}
		}
	}
	return out;
}

/**
 * pi loads packages from its own node_modules; each may carry skills/ and
 * prompts/ at its root or under .pi/. Scoped packages sit one level down.
 */
async function npmPackages(nodeModules: string): Promise<SlashCommand[]> {
	const packages: string[] = [];
	for (const name of await namesIn(nodeModules)) {
		if (name.startsWith('.')) continue;
		if (name.startsWith('@')) {
			for (const inner of await namesIn(join(nodeModules, name))) {
				packages.push(join(nodeModules, name, inner));
			}
		} else {
			packages.push(join(nodeModules, name));
		}
	}
	return flatten(
		packages.flatMap((pkg) => [
			skills(join(pkg, 'skills')),
			skills(join(pkg, '.pi', 'skills')),
			prompts(join(pkg, 'prompts')),
			prompts(join(pkg, '.pi', 'prompts'))
		])
	);
}

async function namesIn(dir: string): Promise<string[]> {
	try {
		if (!(await stat(dir)).isDirectory()) return [];
		return (await readdir(dir)).sort();
	} catch {
		return [];
	}
}

const MAX_DESCRIPTION = 200;
const HEAD_BYTES = 4096;

/**
 * The `description:` of a Markdown file's YAML front matter. Handles the
 * shapes skills actually use: bare, single- or double-quoted, and the `>`
 * / `|` block forms whose text sits indented on the following lines.
 */
export async function frontmatter(file: string): Promise<{ description: string } | null> {
	let head: string;
	try {
		const handle = await readFile(file, 'utf8');
		head = handle.slice(0, HEAD_BYTES);
	} catch {
		return null;
	}
	return { description: parseDescription(head) };
}

export function parseDescription(text: string): string {
	const lines = text.split('\n');
	if (lines[0]?.trim() !== '---') return '';
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() === '---') break;
		const match = /^description:\s*(.*)$/.exec(line);
		if (!match) continue;
		let value = match[1].trim();
		if (value === '>' || value === '|' || value === '>-' || value === '|-') {
			const block: string[] = [];
			for (let j = i + 1; j < lines.length; j++) {
				if (!/^\s+\S/.test(lines[j])) break;
				block.push(lines[j].trim());
			}
			value = block.join(' ');
		} else if (
			(value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
			(value.startsWith("'") && value.endsWith("'") && value.length > 1)
		) {
			value = value.slice(1, -1).replace(/\\"/g, '"');
		}
		const oneLine = value.replace(/\s+/g, ' ').trim();
		return oneLine.length > MAX_DESCRIPTION ? `${oneLine.slice(0, MAX_DESCRIPTION - 1)}…` : oneLine;
	}
	return '';
}
