import { agyAdapter } from './agy';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { copilotAdapter } from './copilot';
import { grokAdapter } from './grok';
import { piAdapter } from './pi';
import { withPhotoPrompts } from './photo';
import type { Adapter } from './types';

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
	return adapter ? withPhotoPrompts(adapter) : null;
}

export type { Adapter, Message, ToolCall } from './types';
