<script lang="ts">
	import CodeBlock from './code-block.svelte';
	import { langForPath } from '$lib/highlight';
	import { prefs } from '$lib/prefs.svelte';

	let {
		name,
		input,
		mono = 11
	}: { name: string; input: Record<string, unknown> | null; mono?: number } = $props();

	function str(value: unknown): string {
		return typeof value === 'string' ? value : '';
	}

	/**
	 * How a terminal shows this call: the argument that matters, in the
	 * language it is written in, rather than the whole argument object.
	 *
	 * `fields` are label/value rows; `code` is the one argument worth
	 * syntax-highlighting. Anything not named here falls through to JSON,
	 * which is still the honest rendering for an MCP tool nobody has taught
	 * this function about.
	 */
	type View = {
		fields: Array<{ k: string; v: string }>;
		code?: { text: string; lang: string | null };
	} | null;

	function view(tool: string, args: Record<string, unknown>): View {
		const path = str(args.file_path) || str(args.notebook_path);
		switch (tool) {
			case 'Bash':
				return {
					fields: str(args.description) ? [{ k: 'why', v: str(args.description) }] : [],
					code: { text: str(args.command), lang: 'bash' }
				};
			case 'Read': {
				const range = [args.offset, args.limit].filter((n) => typeof n === 'number');
				return {
					fields: [
						{ k: 'file', v: path },
						...(range.length ? [{ k: 'lines', v: range.join(' + ') }] : [])
					]
				};
			}
			case 'Write':
				return {
					fields: [{ k: 'file', v: path }],
					code: { text: str(args.content), lang: langForPath(path) }
				};
			case 'Grep':
				return {
					fields: [
						{ k: 'pattern', v: str(args.pattern) },
						...(str(args.path) ? [{ k: 'in', v: str(args.path) }] : []),
						...(str(args.glob) ? [{ k: 'glob', v: str(args.glob) }] : [])
					]
				};
			case 'Glob':
				return {
					fields: [
						{ k: 'pattern', v: str(args.pattern) },
						...(str(args.path) ? [{ k: 'in', v: str(args.path) }] : [])
					]
				};
			case 'WebFetch':
				return {
					fields: [
						{ k: 'url', v: str(args.url) },
						...(str(args.prompt) ? [{ k: 'asking', v: str(args.prompt) }] : [])
					]
				};
			case 'WebSearch':
				return { fields: [{ k: 'query', v: str(args.query) }] };
			case 'Skill':
				return {
					fields: [
						{ k: 'skill', v: str(args.skill) },
						...(str(args.args) ? [{ k: 'args', v: str(args.args) }] : [])
					]
				};
			case 'Task':
			case 'Agent':
				return {
					fields: [
						...(str(args.subagent_type) ? [{ k: 'agent', v: str(args.subagent_type) }] : []),
						...(str(args.description) ? [{ k: 'task', v: str(args.description) }] : [])
					],
					code: str(args.prompt) ? { text: str(args.prompt), lang: 'markdown' } : undefined
				};
			case 'TodoWrite': {
				const todos = Array.isArray(args.todos) ? args.todos : [];
				const mark = (s: string) =>
					s === 'completed' ? '[x]' : s === 'in_progress' ? '[~]' : '[ ]';
				return {
					fields: [],
					code: {
						text: todos
							.map((t) => {
								const todo = t as Record<string, unknown>;
								return `${mark(str(todo.status))} ${str(todo.content) || str(todo.activeForm)}`;
							})
							.join('\n'),
						lang: null
					}
				};
			}
			default:
				return null;
		}
	}

	const raw = $derived(JSON.stringify(input ?? {}, null, 2));
	const formatted = $derived(
		prefs.value.toolDetail === 'formatted' && input ? view(name, input) : null
	);
</script>

{#if formatted}
	{#if formatted.fields.length > 0}
		<dl class="fields" style="--mono: {mono}px">
			{#each formatted.fields as field (field.k)}
				<dt>{field.k}</dt>
				<dd>{field.v}</dd>
			{/each}
		</dl>
	{/if}
	{#if formatted.code && formatted.code.text}
		<CodeBlock code={formatted.code.text} lang={formatted.code.lang} {mono} />
	{/if}
{:else if input}
	<!-- No formatter for this tool, or raw JSON asked for in Settings. -->
	<CodeBlock code={raw} lang="json" {mono} />
{/if}

<style>
	.fields {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.1em 0.6em;
		margin: 0 0 0.4em;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--mono);
	}
	dt {
		opacity: 0.6;
	}
	dd {
		margin: 0;
		min-width: 0;
		/* A path or a URL must wrap rather than widen the whole row. */
		overflow-wrap: anywhere;
	}
</style>
