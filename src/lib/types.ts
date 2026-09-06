import type { Message } from './server/transcript/types';
import type { Picker } from './server/picker';

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export interface AgentSummary {
	paneId: string;
	agent: string;
	title: string;
	status: AgentStatus;
	cwd: string;
	/** herdr state_change_seq — monotonic per pane; drives unread badges. */
	seq: number;
	workspaceId: string;
	workspaceLabel: string;
	/**
	 * One line of "what is this pane doing" for the list row. Filled by the
	 * projector; the list falls back to the cwd when no adapter matched.
	 */
	preview?: string;
	/**
	 * Present only on blocked panes, so `/` can render the inline answer
	 * buttons without a per-pane fetch. Nullable because `AgentDetail`
	 * narrows this to a full `Picker | null` and must stay assignable.
	 */
	picker?: Pick<Picker, 'question' | 'options' | 'multi'> | null;
	/**
	 * A menu or panel is open on the terminal that bordr could not turn into
	 * a picker (omp's model browser, Claude Code's /config): its footer, so
	 * the phone can point at the key strip. Null when there is none.
	 */
	menu?: string | null;
}

export interface AgentDetail extends AgentSummary {
	messages: Message[];
	picker: Picker | null;
	/**
	 * Why `messages` is scraped pane text rather than a parsed transcript;
	 * 'none' means the transcript rendered. Each rung has a different remedy
	 * (install an adapter, run `herdr integration install`, fix permissions,
	 * update bordr), so the reason must reach the operator, not just the fact.
	 */
	degraded: 'none' | 'no-adapter' | 'no-session' | 'unreadable' | 'empty';
	/** Operator-facing explanation of `degraded`, composed server-side; null when 'none'. */
	degradedMessage: string | null;
	/** Tail of the visible terminal screen — what a keypad is driving. */
	screenTail: string;
	/** The harness's own status block (model, context, usage bars), top line first. */
	statusLines: string[];
	/** Earlier messages exist on disk beyond the window that was read. */
	hasMore: boolean;
}

export type { Message, ToolCall } from './server/transcript/types';
export type { Picker, PickerOption } from './server/picker';
