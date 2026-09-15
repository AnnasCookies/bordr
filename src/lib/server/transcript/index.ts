import { agyAdapter } from './agy';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { copilotAdapter } from './copilot';
import { grokAdapter } from './grok';
import { piAdapter } from './pi';
import { withLocalFiles } from './local-files';
import { withPhotoPrompts } from './photo';
import { withSentFiles } from './sent-files';
import { withSecretRedaction } from './redact';
import { backfillBlocks, type Adapter } from './types';

/**
 * Give every message blocks, so the view has exactly one shape to render.
 *
 * Adapters emit blocks as they are migrated; the rest keep returning flat
 * `{text, tools}` and are converted here. Doing it in one place beats a view
 * that branches on which harness produced the turn.
 */
function withBlocks(adapter: Adapter): Adapter {
	return {
		resolve: (sessionId) => adapter.resolve(sessionId),
		parse: (jsonl) => adapter.parse(jsonl).map(backfillBlocks)
	};
}

/** Adapters by herdr agent kind — omp shares pi's format (it is a pi fork). */
const ADAPTERS: Record<string, Adapter> = {
	agy: agyAdapter,
	claude: claudeAdapter,
	codex: codexAdapter,
	copilot: copilotAdapter,
	grok: grokAdapter,
	pi: piAdapter,
	omp: piAdapter
};

export interface AdapterOptions {
	/**
	 * The transcript was fetched from another machine.
	 *
	 * Its SendUserFile paths name files on THAT machine, but `withSentFiles`
	 * reads this host's disk — so a remote transcript could have bordr inline
	 * whatever local image sits at a path it chose. It is left out entirely.
	 */
	remote?: boolean;
	child?: boolean;
}

export function adapterFor(agentKind: string, options: AdapterOptions = {}): Adapter | null {
	const adapter =
		agentKind === 'claude' && options.child
			? { ...claudeAdapter, parse: (text: string) => claudeAdapter.parse(text, true) }
			: ADAPTERS[agentKind];
	if (!adapter) return null;
	// withBlocks first so the decorators above it always have blocks to walk.
	// withSentFiles reads a tool call's own input, so it has to sit outside
	// withBlocks too — a flat `{text, tools}` message has no input to read.
	const local = withLocalFiles(withBlocks(withPhotoPrompts(adapter)));
	return withSecretRedaction(options.remote ? local : withSentFiles(local));
}

export type { Adapter, Block, Message, ToolCall, ToolResult } from './types';
