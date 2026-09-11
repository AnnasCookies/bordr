import { agyAdapter } from './agy';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { copilotAdapter } from './copilot';
import { grokAdapter } from './grok';
import { piAdapter } from './pi';
import { withLocalFiles } from './local-files';
import { withPhotoPrompts } from './photo';
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

export function adapterFor(agentKind: string): Adapter | null {
	const adapter = ADAPTERS[agentKind];
	// withBlocks first so withLocalFiles always has blocks to walk.
	return adapter ? withLocalFiles(withBlocks(withPhotoPrompts(adapter))) : null;
}

export type { Adapter, Block, Message, ToolCall, ToolResult } from './types';
