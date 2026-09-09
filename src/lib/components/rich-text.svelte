<script lang="ts">
	import { browser } from '$app/environment';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';

	let { text, mono = 11 }: { text: string; mono?: number } = $props();

	/**
	 * Agent output is untrusted text that can contain anything, and unlike the
	 * artifacts served by /raw this renders in bordr's OWN origin, where a
	 * script could reach the agent-driving APIs. So: no raw HTML passthrough,
	 * and an allowlist rather than a blocklist.
	 *
	 * The tag list is what markdown actually produces plus the wrappers added
	 * below — anything else an agent writes is stripped to its text.
	 */
	const ALLOWED_TAGS = [
		'p',
		'br',
		'hr',
		'strong',
		'em',
		'del',
		'code',
		'pre',
		'span',
		'div',
		'blockquote',
		'ul',
		'ol',
		'li',
		'a',
		'img',
		'h1',
		'h2',
		'h3',
		'h4',
		'h5',
		'h6',
		'table',
		'thead',
		'tbody',
		'tr',
		'th',
		'td'
	];

	function render(source: string): string {
		const html = marked.parse(source, { async: false, gfm: true, breaks: true });
		return DOMPurify.sanitize(html, {
			ALLOWED_TAGS,
			ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'colspan', 'rowspan'],
			// A markdown link is fine; javascript:, data: and every other
			// scheme an agent could write is not.
			ALLOWED_URI_REGEXP: /^(?:https?:|\/(?!\/)|#|mailto:)/i,
			FORBID_TAGS: ['style', 'form', 'iframe', 'script', 'object', 'embed'],
			FORBID_ATTR: ['style', 'onerror', 'onload', 'srcset']
		});
	}

	/**
	 * Browser only. DOMPurify needs a DOM, so on the server `sanitize` is
	 * undefined and rendering there 500s the whole conversation. Sending
	 * unsanitised HTML from SSR instead is not an option — that is the exact
	 * thing the sanitiser is for — so the server emits the plain source and
	 * hydration upgrades it in place.
	 */
	const html = $derived(browser ? render(text) : '');
</script>

<div class="rich" style="--mono: {mono}px">
	{#if browser}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitised directly above -->
		{@html html}
	{:else}
		<span class="raw">{text}</span>
	{/if}
</div>

<style>
	.raw {
		white-space: pre-wrap;
	}
	.rich :global(p) {
		margin: 0 0 0.6em;
	}
	.rich :global(p:last-child) {
		margin-bottom: 0;
	}
	.rich :global(h1),
	.rich :global(h2),
	.rich :global(h3),
	.rich :global(h4) {
		margin: 0.9em 0 0.4em;
		font-size: 1em;
		font-weight: 650;
		line-height: 1.35;
	}
	.rich :global(h1:first-child),
	.rich :global(h2:first-child),
	.rich :global(h3:first-child) {
		margin-top: 0;
	}
	.rich :global(ul),
	.rich :global(ol) {
		margin: 0 0 0.6em;
		padding-left: 1.35em;
	}
	.rich :global(li) {
		margin: 0.15em 0;
	}
	.rich :global(blockquote) {
		margin: 0 0 0.6em;
		padding-left: 0.7em;
		border-left: 2px solid color-mix(in srgb, currentColor 25%, transparent);
		opacity: 0.85;
	}
	.rich :global(a) {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.rich :global(hr) {
		margin: 0.8em 0;
		border: 0;
		border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
	}
	.rich :global(code) {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--mono);
		padding: 0.1em 0.32em;
		border-radius: 4px;
		background: color-mix(in srgb, currentColor 10%, transparent);
		/* A long identifier must not widen the whole message. */
		overflow-wrap: anywhere;
	}
	/* Fenced blocks scroll inside themselves. The page must never scroll
	   sideways on a phone — that is what makes a wide diff unreadable. */
	.rich :global(pre) {
		margin: 0 0 0.6em;
		padding: 0.6em 0.7em;
		border-radius: 8px;
		background: color-mix(in srgb, currentColor 8%, transparent);
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}
	.rich :global(pre code) {
		display: block;
		padding: 0;
		background: none;
		white-space: pre;
		overflow-wrap: normal;
	}
	.rich :global(img) {
		max-width: 100%;
		height: auto;
		border-radius: 8px;
	}
	/* Same rule for tables: scroll the table, never the page. */
	.rich :global(table) {
		display: block;
		width: max-content;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		margin: 0 0 0.6em;
		font-size: var(--mono);
	}
	.rich :global(th),
	.rich :global(td) {
		border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
		padding: 0.3em 0.5em;
		text-align: left;
	}
	.rich :global(th) {
		font-weight: 650;
		background: color-mix(in srgb, currentColor 7%, transparent);
	}
</style>
