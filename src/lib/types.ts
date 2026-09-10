import type { Activity } from './server/activity';
import type { Machine } from './server/herdr/machines';

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
	/**
	 * The ghost prompt the harness is offering in its own input box, which a
	 * terminal accepts with the right arrow. Never in the transcript — nothing
	 * is written until it is accepted — so it is read off the screen.
	 */
	suggestion: string | null;
	/** Tail of the visible terminal screen — what a keypad is driving. */
	screenTail: string;
	/**
	 * The harness's live activity line — "Channeling… (4m 36s · ↓ 6.5k tokens)"
	 * — with the tip it prints underneath. Null when nothing is running.
	 */
	activity: Activity | null;
	/** The harness's own status block (model, context, usage bars), top line first. */
	statusLines: string[];
	/**
	 * The same lines carrying their terminal colour, for display. Same length
	 * and order as `statusLines`, which stays plain because the screen filter
	 * and every other consumer wants text, not escapes.
	 */
	statusAnsi: string[];
	/** Earlier messages exist on disk beyond the window that was read. */
	hasMore: boolean;
}

export type { Message, ToolCall } from './server/transcript/types';
export type { Picker, PickerOption } from './server/picker';

/** One pane in the session tree. A pane without an agent is a plain shell. */
export interface PaneNode {
	paneId: string;
	tabId: string;
	workspaceId: string;
	/** Harness kind, or '' for a shell. */
	agent: string;
	hasAgent: boolean;
	/** An agent's lifecycle status, or 'shell' when there is no agent. */
	status: string;
	title: string;
	cwd: string;
	focused: boolean;
}

export interface TabNode {
	tabId: string;
	workspaceId: string;
	label: string;
	number: number;
	focused: boolean;
	panes: PaneNode[];
}

export interface WorkspaceNode {
	workspaceId: string;
	/** The machine this workspace lives on; empty for this host. */
	machine: string;
	label: string;
	number: number;
	focused: boolean;
	tabs: TabNode[];
}

export type { Activity };

export type { Machine };
