import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_COMMANDS } from './commands-builtin';
import type { SlashCommand } from '$lib/commands';

export type { SlashCommand } from '$lib/commands';

/**
 * What the composer offers when the person types `/`.
 *
 * The harness's own popup never reaches the phone — bordr sends a message
 * whole, so the harness sees `/model⏎`, never `/mo` — and so bordr builds
 * its own list. OMP exposes the live list from its loaders; other harnesses
 * use a built-in snapshot plus the person's configured files:
 *
 *   Claude Code   ~/.claude/skills/<n>/SKILL.md, ~/.claude/commands/<n>.md,
 *                 the same two under the project's .claude/, and installed
 *                 plugins as /<plugin>:<n>
 *   pi            ~/.agents/skills as /skill:<n>; its own skills and
 *                 prompts dirs; npm packages' skills/ and prompts/ as /<n>
 *   omp           live built-ins, extensions, skills and prompts
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

	const installed = await discover(agent, cwd);
	const hasLiveBuiltins =
		agent === 'omp' && installed.some((command) => command.source === 'builtin');
	const builtin = hasLiveBuiltins
		? []
		: (BUILTIN_COMMANDS[agent] ?? []).map<SlashCommand>(([name, description]) => ({
				name,
				description,
				source: 'builtin'
			}));
	// Built-ins first, then the person's own, each name once: a skill that
	// shadows a built-in keeps the built-in's row (that is what the harness
	// runs). OMP's live probe already returns that same order.
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
		case 'pi': {
			const own = join(HOME(), '.pi', 'agent');
			return flatten([
				skills(AGENTS_SKILLS(), 'skill:'),
				skills(join(own, 'skills'), 'skill:'),
				skills(join(own, 'managed-skills'), 'skill:'),
				prompts(join(own, 'prompts')),
				npmPackages(join(own, 'npm', 'node_modules'))
			]);
		}
		case 'omp': {
			const live = await probeOmpCommands(cwd);
			if (live.length > 0) return live;
			const own = join(HOME(), '.omp', 'agent');
			return flatten([
				skills(AGENTS_SKILLS(), 'skill:'),
				skills(join(own, 'skills'), 'skill:'),
				skills(join(own, 'managed-skills'), 'skill:'),
				commands(join(cwd, '.omp', 'commands')),
				commands(join(own, 'commands')),
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

const OMP_COMMAND_MARKER = 'BORDR_OMP_COMMANDS=';
const OMP_PROBE_SOURCE = `import { BUILTIN_SLASH_COMMAND_DEFS } from '@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry';

export default function (pi) {
	pi.on('session_start', () => {
		const builtins = BUILTIN_SLASH_COMMAND_DEFS.map(({ name, description }) => ({
			name,
			description,
			source: 'builtin'
		}));
		console.log('${OMP_COMMAND_MARKER}' + JSON.stringify([...builtins, ...pi.getCommands()]));
		process.exit(0);
	});
}
`;

function ompSource(source: unknown): SlashCommand['source'] {
	switch (source) {
		case 'builtin':
			return 'builtin';
		case 'skill':
			return 'skill';
		case 'prompt':
			return 'prompt';
		case 'extension':
			return 'extension';
		default:
			return 'plugin';
	}
}

/** Parse the one machine-readable line emitted amid OMP's startup output. */
export function parseOmpCommandProbe(output: string): SlashCommand[] {
	const marker = output.indexOf(OMP_COMMAND_MARKER);
	if (marker < 0) return [];
	const line = output.slice(marker + OMP_COMMAND_MARKER.length).split(/\r?\n/, 1)[0];
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	const commands: SlashCommand[] = [];
	for (const item of parsed) {
		if (!item || typeof item !== 'object' || !('name' in item) || typeof item.name !== 'string') {
			continue;
		}
		const description =
			'description' in item && typeof item.description === 'string' ? item.description : '';
		const source = 'source' in item ? item.source : undefined;
		commands.push({ name: item.name, description, source: ompSource(source) });
	}
	return commands;
}

function runOmpProbe(extension: string, cwd: string): Promise<string> {
	const args = ['--no-session', '--extension', extension];
	const configured = process.env.OMP_BIN?.trim();
	const executable = configured || userInfo().shell || '/bin/sh';
	const executableArgs = configured ? args : ['-ic', 'exec omp "$@"', 'bordr-omp-probe', ...args];
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const child = execFile(
		executable,
		executableArgs,
		{ cwd, timeout: 15_000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
		(error, stdout) => {
			if (error) reject(error);
			else resolve(stdout);
		}
	);
	child.stdin?.end();
	return promise;
}

/**
 * OMP's command list is built by its live extension and skill loaders. Asking
 * OMP is the only way to include extension-registered commands without
 * reimplementing that loader. The probe never calls a model and leaves no
 * session behind.
 */
async function probeOmpCommands(cwd: string): Promise<SlashCommand[]> {
	const dir = await mkdtemp(join(tmpdir(), 'bordr-omp-commands-'));
	const extension = join(dir, 'probe.mjs');
	try {
		await writeFile(extension, OMP_PROBE_SOURCE);
		const stdout = await runOmpProbe(extension, cwd);
		return parseOmpCommandProbe(stdout);
	} catch (error) {
		console.warn(
			`bordr: live OMP command discovery failed: ${error instanceof Error ? error.message : error}`
		);
		return [];
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
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
