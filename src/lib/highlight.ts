import type { HighlighterCore } from 'shiki/core';

/**
 * Syntax highlighting, VS Code's own grammars and themes.
 *
 * Everything here is loaded lazily and per language: shiki's full bundle is
 * megabytes, and a phone should download a Python grammar only if an agent
 * actually wrote Python. The JavaScript regex engine is used rather than
 * oniguruma so there is no WebAssembly payload either.
 *
 * Highlighting runs on TEXT and emits markup we generated, which is what
 * makes it safe to insert: agent-authored HTML never survives this path.
 */

/** VS Code's default themes, so the result looks like the editor. */
const DARK = 'dark-plus';
const LIGHT = 'light-plus';

/** Grammars worth carrying. Anything else renders as plain monospace. */
const LOADERS: Record<string, () => Promise<unknown>> = {
	bash: () => import('@shikijs/langs/bash'),
	css: () => import('@shikijs/langs/css'),
	diff: () => import('@shikijs/langs/diff'),
	go: () => import('@shikijs/langs/go'),
	html: () => import('@shikijs/langs/html'),
	java: () => import('@shikijs/langs/java'),
	javascript: () => import('@shikijs/langs/javascript'),
	json: () => import('@shikijs/langs/json'),
	markdown: () => import('@shikijs/langs/markdown'),
	powershell: () => import('@shikijs/langs/powershell'),
	python: () => import('@shikijs/langs/python'),
	rust: () => import('@shikijs/langs/rust'),
	sql: () => import('@shikijs/langs/sql'),
	svelte: () => import('@shikijs/langs/svelte'),
	toml: () => import('@shikijs/langs/toml'),
	typescript: () => import('@shikijs/langs/typescript'),
	yaml: () => import('@shikijs/langs/yaml')
};

/** What people actually type in a fence, and what a file extension implies. */
const ALIAS: Record<string, string> = {
	c: 'c',
	cjs: 'javascript',
	cts: 'typescript',
	htm: 'html',
	js: 'javascript',
	json5: 'json',
	jsonc: 'json',
	jsx: 'javascript',
	md: 'markdown',
	mjs: 'javascript',
	mts: 'typescript',
	patch: 'diff',
	pl: 'perl',
	ps1: 'powershell',
	py: 'python',
	rs: 'rust',
	sh: 'bash',
	shell: 'bash',
	tf: 'terraform',
	ts: 'typescript',
	tsx: 'typescript',
	yml: 'yaml',
	zsh: 'bash'
};

export function canonicalLang(raw: string | undefined | null): string | null {
	if (!raw) return null;
	const name = raw.trim().toLowerCase();
	const resolved = ALIAS[name] ?? name;
	return resolved in LOADERS ? resolved : null;
}

/** The language a path implies, for an Edit's diff. */
export function langForPath(path: string): string | null {
	const dot = path.lastIndexOf('.');
	return dot === -1 ? null : canonicalLang(path.slice(dot + 1));
}

let core: Promise<HighlighterCore> | null = null;
const ready = new Set<string>();

async function highlighter(): Promise<HighlighterCore> {
	if (!core) {
		core = (async () => {
			const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, dark, light] =
				await Promise.all([
					import('shiki/core'),
					import('shiki/engine/javascript'),
					import('@shikijs/themes/dark-plus'),
					import('@shikijs/themes/light-plus')
				]);
			return createHighlighterCore({
				themes: [dark.default, light.default],
				langs: [],
				// forgiving: a TextMate grammar can use an Oniguruma construct
				// the JS engine cannot express. Better to lose one rule's
				// colour than to throw and render nothing.
				engine: createJavaScriptRegexEngine({ forgiving: true })
			});
		})();
	}
	return core;
}

/**
 * Highlighted HTML for `code`, or null when the language is unknown or
 * anything goes wrong — callers fall back to plain monospace.
 */
export async function highlight(
	code: string,
	lang: string | null,
	dark: boolean
): Promise<string | null> {
	const resolved = canonicalLang(lang);
	if (!resolved) return null;
	try {
		const shiki = await highlighter();
		if (!ready.has(resolved)) {
			const mod = (await LOADERS[resolved]()) as {
				default: Parameters<typeof shiki.loadLanguage>[0];
			};
			await shiki.loadLanguage(mod.default);
			ready.add(resolved);
		}
		return shiki.codeToHtml(code, {
			lang: resolved,
			theme: dark ? DARK : LIGHT,
			// The wrapper's own background would fight the bubble it sits in.
			structure: 'inline'
		});
	} catch {
		return null;
	}
}
