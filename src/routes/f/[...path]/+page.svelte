<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { prefs } from '$lib/prefs.svelte';
	import Icon from '$lib/components/icon.svelte';
	import TabBar from '$lib/components/tab-bar.svelte';
	import type { DirEntry } from './+page.server';

	let { data } = $props();

	/**
	 * Raw bytes live on their own route so this page can be Svelte. The cast
	 * keeps the `?dl=1` form a resolved path, so no-navigation-without-resolve
	 * stays enforced everywhere else rather than being switched off here.
	 */
	function rawHref(path: string, download = false): ResolvedPathname {
		const base = resolve('/raw/[...path]', { path });
		return download ? (`${base}?dl=1` as ResolvedPathname) : base;
	}

	function browseHref(path: string) {
		return resolve('/f/[...path]', { path });
	}

	const parentPath = $derived(data.path.split('/').slice(0, -1).join('/'));
	const crumbs = $derived(
		data.path
			.split('/')
			.filter(Boolean)
			.map((part, i, all) => ({ part, path: all.slice(0, i + 1).join('/') }))
	);

	function size(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	function when(ms: number): string {
		if (!ms) return '';
		return new Date(ms).toLocaleDateString('en-GB', {
			day: '2-digit',
			month: 'short',
			year: '2-digit'
		});
	}

	/** Share the FILE where the platform allows it, the URL where it does not. */
	async function share(path: string, name: string) {
		try {
			const response = await fetch(rawHref(path));
			const blob = await response.blob();
			const file = new File([blob], name, { type: blob.type });
			if (navigator.canShare?.({ files: [file] })) {
				await navigator.share({ files: [file], title: name });
			} else {
				await navigator.share({ title: name, url: location.origin + rawHref(path) });
			}
		} catch {
			// The user dismissed the sheet, or the platform has no share.
		}
	}

	// --- row actions sheet ----------------------------------------------------
	let sheetFor = $state<DirEntry | null>(null);
	let copied = $state(false);
	let pressTimer: ReturnType<typeof setTimeout> | undefined;

	function openSheet(entry: DirEntry) {
		sheetFor = entry;
		copied = false;
	}
	function pressStart(entry: DirEntry) {
		pressTimer = setTimeout(() => openSheet(entry), 500);
	}
	function pressEnd() {
		clearTimeout(pressTimer);
	}

	async function copyPath(path: string) {
		try {
			await navigator.clipboard.writeText(path);
			copied = true;
		} catch {
			copied = false;
		}
	}

	// --- send to an agent -----------------------------------------------------
	let sendingTo = $state<string | null>(null);
	let sendResult = $state<string | null>(null);
	let agents = $state<Array<{ paneId: string; title: string; agent: string }>>([]);

	async function loadAgents() {
		try {
			const body = (await (await fetch('/api/agents')).json()) as { agents: typeof agents };
			agents = body.agents ?? [];
		} catch {
			agents = [];
		}
	}

	async function sendPath(paneId: string, path: string) {
		sendResult = null;
		try {
			const response = await fetch(`/api/agents/${encodeURIComponent(paneId)}/prompt`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text: path })
			});
			sendResult = response.ok ? 'Sent.' : 'Could not send it.';
		} catch {
			sendResult = 'Could not send it.';
		}
		sendingTo = null;
	}

	// --- viewer bodies --------------------------------------------------------
	let body = $state<string | null>(null);
	let bodyError = $state<string | null>(null);
	let showSource = $state(false);
	let imageIndex = $state(0);

	const isFile = $derived(data.mode === 'file');
	const fileName = $derived(data.mode === 'file' ? data.name : '');
	const kind = $derived(data.mode === 'file' ? data.kind : 'binary');

	/**
	 * How much of a text file is rendered inline. One element per line for a
	 * 5 MB log froze Safari outright; the rest is one "Open raw" away.
	 */
	const TEXT_HEAD_BYTES = 1024 * 1024;
	const bodyTruncated = $derived(data.mode === 'file' && data.size > TEXT_HEAD_BYTES);

	/**
	 * Read only the head of the response and cancel the rest, so a large file
	 * costs neither the transfer nor the parse. A partial multi-byte sequence
	 * at the cut is held back by the streaming decoder rather than mangled.
	 */
	async function readHead(response: Response, limit: number): Promise<string> {
		const reader = response.body?.getReader();
		if (!reader) return (await response.text()).slice(0, limit);
		const decoder = new TextDecoder();
		let text = '';
		let received = 0;
		while (received < limit) {
			const { done, value } = await reader.read();
			if (done) return text + decoder.decode();
			received += value.byteLength;
			text += decoder.decode(value, { stream: true });
		}
		await reader.cancel();
		return text;
	}

	/** Text-ish bodies are fetched once per file; bytes come from /raw. */
	$effect(() => {
		if (!isFile || (kind !== 'markdown' && kind !== 'text')) return;
		const path = data.path;
		body = null;
		bodyError = null;
		void (async () => {
			try {
				const response = await fetch(rawHref(path));
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				body = await readHead(response, TEXT_HEAD_BYTES);
			} catch (e) {
				bodyError = (e as Error).message;
			}
		})();
	});

	$effect(() => {
		if (data.mode !== 'file' || data.kind !== 'image') return;
		imageIndex = Math.max(0, data.siblings.indexOf(data.name));
	});

	/**
	 * Markdown is rendered client-side and sanitised before it is inserted.
	 * The source is a file on disk that an agent wrote — untrusted, which is
	 * exactly why raw HTML blocks are stripped rather than trusted.
	 */
	const rendered = $derived.by(() => {
		if (kind !== 'markdown' || body === null) return '';
		const html = marked.parse(body, { async: false, gfm: true, breaks: false });
		return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'iframe'] });
	});

	const lines = $derived(body === null ? [] : body.split('\n'));
	const prettyJson = $derived.by(() => {
		if (kind !== 'text' || body === null || !fileName.endsWith('.json')) return null;
		try {
			return JSON.stringify(JSON.parse(body), null, 2).split('\n');
		} catch {
			return null;
		}
	});
	const textLines = $derived(prettyJson ?? lines);
</script>

<div class="flex min-h-dvh flex-col">
	<header class="sticky top-0 z-10 border-b border-hairline bg-page">
		<div class="flex items-center gap-1 px-2 pt-1 pb-1.5">
			<a
				href={browseHref(isFile || data.path ? parentPath : '')}
				class="flex h-10 w-10 shrink-0 items-center justify-center font-mono text-base text-working"
				aria-label="Up">←</a
			>
			<span class="min-w-0 flex-1 truncate font-mono text-[13px]">
				{#if crumbs.length === 0}
					<span class="font-medium">files</span>
				{:else}
					{#each crumbs as crumb, i (crumb.path)}<a
							href={browseHref(crumb.path)}
							class={i === crumbs.length - 1 ? 'font-medium' : 'text-faint'}>{crumb.part}</a
						>{#if i < crumbs.length - 1}<span class="text-faint">/</span>{/if}{/each}
				{/if}
			</span>
		</div>
	</header>

	<main class="flex-1 px-4 pt-3 pb-24">
		{#if data.mode === 'roots'}
			{#if data.roots.length === 0}
				<p
					class="rounded-xl border border-dashed border-edge px-4 py-8 text-center text-[13px] text-muted"
				>
					No file roots exist on this machine. Set BORDR_FILE_ROOTS in .env (README, step 3) and
					restart.
				</p>
			{:else}
				<ul
					class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
				>
					{#each data.roots as root (root)}
						<li>
							<a href={browseHref(root)} class="flex items-center gap-2.5 px-3.5 py-3">
								<span class="h-5 w-[26px] shrink-0 rounded bg-folder-chip"></span>
								<span class="flex-1 font-mono text-[13.5px]">{root}</span>
								<span class="text-faint">›</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if data.mode === 'directory'}
			<ul
				class="divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
			>
				{#each data.entries as entry (entry.name)}
					<li class="flex items-center gap-2 pr-2">
						<a
							href={browseHref(`${data.path}/${entry.name}`)}
							class="flex min-w-0 flex-1 items-center gap-2.5 py-3 pl-3.5"
							oncontextmenu={(e) => {
								if (entry.dir) return;
								e.preventDefault();
								openSheet(entry);
							}}
							ontouchstart={() => !entry.dir && pressStart(entry)}
							ontouchend={pressEnd}
							ontouchmove={pressEnd}
						>
							<span
								class="flex h-5 w-[26px] shrink-0 items-center justify-center rounded text-[9px] font-medium {entry.dir
									? 'bg-folder-chip'
									: entry.kind === 'sandboxed'
										? 'bg-html-chip text-html-chip-ink'
										: 'bg-chip text-muted'}"
							>
								{entry.dir ? '' : (entry.name.split('.').pop() ?? '').slice(0, 4)}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-mono text-[13.5px]">{entry.name}</span>
								{#if !entry.dir}
									<span class="block truncate text-[11.5px] text-muted">
										{entry.kind === 'sandboxed' ? 'Preview · ' : ''}{size(entry.size)} · {when(
											entry.mtime
										)}
									</span>
								{/if}
							</span>
							{#if entry.dir}<span class="shrink-0 text-faint">›</span>{/if}
						</a>
						{#if !entry.dir}
							<a
								href={rawHref(`${data.path}/${entry.name}`, true)}
								class="flex h-9 w-9 shrink-0 items-center justify-center text-muted"
								aria-label="Download {entry.name}"
							>
								<Icon name="download" size={17} />
							</a>
							<button
								class="flex h-9 w-9 shrink-0 items-center justify-center text-muted"
								aria-label="Share {entry.name}"
								onclick={() => share(`${data.path}/${entry.name}`, entry.name)}
							>
								<Icon name="share" size={17} />
							</button>
						{/if}
					</li>
				{:else}
					<li class="px-3.5 py-6 text-center text-[13px] text-muted">Nothing here.</li>
				{/each}
			</ul>

			<p class="mt-3 text-[11.5px] text-faint">
				Tap a row to preview (md, images, pdf, html, text). Long-press for Download · Share · Send ·
				Copy path. HTML renders in a sandboxed opaque origin.
			</p>
		{:else}
			<p class="mb-2 font-mono text-[11px] text-muted">
				{data.mime} · {size(data.size)} · {when(data.mtime)}
			</p>

			{#if kind === 'markdown'}
				<div class="mb-3 flex gap-0.5 rounded-[9px] bg-chip p-[3px]">
					{#each [{ v: false, l: 'Rendered' }, { v: true, l: 'Source' }] as option (option.l)}
						<button
							class="min-h-9 flex-1 rounded-[7px] text-[13px] {showSource === option.v
								? 'bg-card text-ink shadow-[0_1px_2px_rgba(0,0,0,.08)]'
								: 'text-muted'}"
							onclick={() => (showSource = option.v)}>{option.l}</button
						>
					{/each}
				</div>
			{/if}

			{#if bodyTruncated && (kind === 'markdown' || kind === 'text') && body !== null}
				<p class="mb-2 rounded-[10px] bg-chip px-3 py-2 text-[12.5px] text-muted">
					Showing the first 1 MB;
					<a href={rawHref(data.path)} target="_blank" rel="noopener" class="text-working"
						>open raw</a
					> for the rest.
				</p>
			{/if}

			{#if bodyError}
				<p class="rounded-[10px] bg-danger-bg px-3 py-2.5 text-[12.5px] text-danger-ink">
					Could not read this file: {bodyError}
				</p>
			{:else if kind === 'markdown' && !showSource}
				{#if body === null}
					<p class="text-[13px] text-muted">Reading…</p>
				{:else}
					<!--
						Safe: rendered by marked and then sanitised by DOMPurify with
						style/form/iframe forbidden. The source is a file an agent wrote,
						which is exactly why it is sanitised rather than trusted.
					-->
					<!-- eslint-disable svelte/no-at-html-tags -->
					<div class="bordr-md text-[15px] leading-[1.55] text-body">{@html rendered}</div>
				{/if}
			{:else if kind === 'image'}
				<div class="overflow-hidden rounded-xl bg-black">
					<img
						src={rawHref(
							data.siblings.length ? `${parentPath}/${data.siblings[imageIndex]}` : `${data.path}`
						)}
						alt={fileName}
						class="mx-auto max-h-[70dvh] w-full object-contain"
						style="touch-action: pinch-zoom"
					/>
				</div>
				{#if data.siblings.length > 1}
					<div class="mt-2 flex items-center justify-between">
						<button
							class="min-h-11 px-3 text-[13px] text-working disabled:opacity-40"
							disabled={imageIndex === 0}
							onclick={() => (imageIndex -= 1)}>← prev</button
						>
						<span class="font-mono text-[11.5px] text-muted"
							>{imageIndex + 1} / {data.siblings.length}</span
						>
						<button
							class="min-h-11 px-3 text-[13px] text-working disabled:opacity-40"
							disabled={imageIndex >= data.siblings.length - 1}
							onclick={() => (imageIndex += 1)}>next →</button
						>
					</div>
				{/if}
			{:else if kind === 'sandboxed' || kind === 'pdf'}
				<div class="overflow-hidden rounded-xl border border-hairline bg-card">
					<iframe
						src={rawHref(data.path)}
						title={fileName}
						sandbox={kind === 'pdf' ? undefined : 'allow-scripts'}
						class="h-[70dvh] w-full border-0 bg-white"
					></iframe>
				</div>
				{#if kind === 'sandboxed'}
					<p class="mt-1.5 text-[11.5px] text-faint">
						iframe sandbox="allow-scripts" · opaque origin · no bordr API access
					</p>
				{/if}
			{:else if kind === 'text' || (kind === 'markdown' && showSource)}
				{#if body === null}
					<p class="text-[13px] text-muted">Reading…</p>
				{:else}
					<div
						class="overflow-x-auto rounded-xl border border-hairline bg-card px-3 py-2.5 font-mono text-body"
						style="font-size: {prefs.value.monoSize + 0.5}px"
					>
						{#each textLines as line, i (i)}
							<div class="flex gap-3 whitespace-pre">
								<span class="w-8 shrink-0 text-right text-faint select-none">{i + 1}</span>
								<span>{line || ' '}</span>
							</div>
						{/each}
					</div>
				{/if}
			{:else}
				<div class="rounded-xl border border-hairline bg-card px-3.5 py-6 text-center">
					<p class="font-mono text-[13px]">{fileName}</p>
					<p class="mt-1 text-[12.5px] text-muted">
						{size(data.size)} · no inline preview for this type.
					</p>
				</div>
			{/if}

			{#if sendResult}
				<p class="mt-3 rounded-[10px] bg-chip px-3 py-2 text-[12.5px] text-muted">{sendResult}</p>
			{/if}
		{/if}
	</main>

	{#if isFile}
		<div
			class="sticky bottom-0 z-10 flex gap-2 border-t border-hairline bg-page px-3 py-2.5"
			style="padding-bottom: max(0.625rem, env(safe-area-inset-bottom))"
		>
			<a
				href={rawHref(data.path, true)}
				class="flex flex-1 flex-col items-center gap-0.5 rounded-[10px] py-2 text-[11px] font-medium text-muted"
			>
				<Icon name="download" size={18} />
				Download
			</a>
			<button
				class="flex flex-1 flex-col items-center gap-0.5 rounded-[10px] py-2 text-[11px] font-medium text-muted"
				onclick={() => share(data.path, fileName)}
			>
				<Icon name="share" size={18} />
				Share
			</button>
			<a
				href={rawHref(data.path)}
				target="_blank"
				rel="noopener"
				class="flex flex-1 flex-col items-center gap-0.5 rounded-[10px] py-2 text-[11px] font-medium text-muted"
			>
				<Icon name="arrow-up-right" size={18} />
				Open raw
			</a>
			<button
				class="flex flex-[1.4] flex-col items-center gap-0.5 rounded-[10px] bg-ink py-2 text-[11px] font-medium text-card"
				onclick={() => {
					sendingTo = data.path;
					void loadAgents();
				}}
			>
				<Icon name="arrow-up" size={18} />
				Send to agent
			</button>
		</div>
	{/if}

	<TabBar />
</div>

{#if sheetFor}
	<button
		class="fixed inset-0 z-40 cursor-default"
		style="background: var(--scrim)"
		aria-label="Close"
		onclick={() => (sheetFor = null)}
	></button>
	<div
		class="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-screen-sm rounded-t-[20px] bg-page pb-4 shadow-[0_-10px_40px_rgba(0,0,0,.25)]"
		role="dialog"
		aria-modal="true"
		aria-label={sheetFor.name}
	>
		<div class="flex justify-center pt-2.5 pb-1">
			<span class="h-[5px] w-9 rounded-full bg-idle-rail"></span>
		</div>
		<p class="truncate px-4 py-2 font-mono text-[13px]">{sheetFor.name}</p>
		<div
			class="mx-4 divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
		>
			<a href={browseHref(`${data.path}/${sheetFor.name}`)} class="block px-3.5 py-3 text-[13px]"
				>Preview</a
			>
			<a href={rawHref(`${data.path}/${sheetFor.name}`, true)} class="block px-3.5 py-3 text-[13px]"
				>Download</a
			>
			<button
				class="block w-full px-3.5 py-3 text-left text-[13px]"
				onclick={() => sheetFor && share(`${data.path}/${sheetFor.name}`, sheetFor.name)}
				>Share</button
			>
			<button
				class="block w-full px-3.5 py-3 text-left text-[13px]"
				onclick={() => {
					sendingTo = `${data.path}/${sheetFor?.name}`;
					sheetFor = null;
					void loadAgents();
				}}>Send path to an agent</button
			>
			<button
				class="block w-full px-3.5 py-3 text-left text-[13px]"
				onclick={() => sheetFor && copyPath(`${data.path}/${sheetFor.name}`)}
				>{copied ? 'Copied' : 'Copy path'}</button
			>
		</div>
	</div>
{/if}

{#if sendingTo}
	<button
		class="fixed inset-0 z-40 cursor-default"
		style="background: var(--scrim)"
		aria-label="Close"
		onclick={() => (sendingTo = null)}
	></button>
	<div
		class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[70dvh] max-w-screen-sm overflow-y-auto rounded-t-[20px] bg-page pb-4"
		role="dialog"
		aria-modal="true"
		aria-label="Send to an agent"
	>
		<div class="flex justify-center pt-2.5 pb-1">
			<span class="h-[5px] w-9 rounded-full bg-idle-rail"></span>
		</div>
		<p class="px-4 py-2 text-[13px] text-muted">Send this path to…</p>
		<ul
			class="mx-4 divide-y divide-black/[.06] overflow-hidden rounded-xl border border-hairline bg-card dark:divide-white/[.06]"
		>
			{#each agents as pane (pane.paneId)}
				<li>
					<button
						class="block w-full px-3.5 py-3 text-left text-[13px]"
						onclick={() => sendingTo && sendPath(pane.paneId, sendingTo)}
					>
						{pane.title || pane.paneId}
						<span class="text-muted">· {pane.agent}</span>
					</button>
				</li>
			{:else}
				<li class="px-3.5 py-4 text-center text-[13px] text-muted">No agents running.</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	/* Markdown body: the transcript's code-span and tool-block idiom, reused. */
	.bordr-md :global(h1) {
		font-size: 22px;
		font-weight: 600;
		color: var(--ink);
		margin: 1.2em 0 0.4em;
	}
	.bordr-md :global(h2),
	.bordr-md :global(h3) {
		font-size: 16px;
		font-weight: 600;
		color: var(--ink);
		margin: 1.2em 0 0.4em;
	}
	.bordr-md :global(p),
	.bordr-md :global(ul),
	.bordr-md :global(ol) {
		margin: 0.6em 0;
	}
	.bordr-md :global(ul),
	.bordr-md :global(ol) {
		padding-left: 1.3em;
		list-style: revert;
	}
	.bordr-md :global(a) {
		color: var(--working);
		overflow-wrap: anywhere;
	}
	.bordr-md :global(code) {
		font-family: var(--font-mono);
		font-size: 12px;
		background: var(--card);
		border: 1px solid var(--hairline);
		border-radius: 4px;
		padding: 1px 5px;
	}
	.bordr-md :global(pre) {
		background: var(--card);
		border: 1px solid var(--hairline);
		border-radius: 8px;
		padding: 10px;
		overflow-x: auto;
	}
	.bordr-md :global(pre code) {
		border: 0;
		background: none;
		padding: 0;
		font-size: 11.5px;
		white-space: pre;
	}
	.bordr-md :global(blockquote) {
		border-left: 2px solid var(--edge);
		padding-left: 10px;
		color: var(--muted);
	}
	.bordr-md :global(table) {
		display: block;
		overflow-x: auto;
		border-collapse: collapse;
	}
	.bordr-md :global(th),
	.bordr-md :global(td) {
		border: 1px solid var(--hairline);
		padding: 4px 8px;
		text-align: left;
	}
	.bordr-md :global(img) {
		max-width: 100%;
	}
</style>
