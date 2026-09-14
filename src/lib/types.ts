import type { Activity } from './server/activity';
import type { Machine } from './server/herdr/machines';

import type { Message } from './server/transcript/types';
import type { Picker } from './server/picker';
import type { SubagentSummary } from './server/transcript/subagents';

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
	/**
	 * The harness's own status rows, condensed — model, context, spend, quota.
	 * Lifted off the same screen reading the list already takes, so they cost
	 * no extra call. Empty when the harness prints no footer.
	 *
	 * Several, because which one matters is a per-harness habit: the list shows
	 * whichever row you settled on in the conversation's status block.
	 */
	statusRows?: string[];
	/** The pane the terminal itself is looking at. */
	focused?: boolean;
	/**
	 * The git state of `cwd`, for the row and the list's filters.
	 *
	 * Optional because `AgentDetail` narrows these to required — the detail
	 * reads the AGENT's directory, which is a better answer than the pane's,
	 * and must stay assignable to this.
	 */
	branch?: string;
	ahead?: number;
	behind?: number;
}

export interface AgentDetail extends AgentSummary {
	/**
	 * The pane's own cwd, as herdr reports it — where a key sent to the
	 * terminal would actually run.
	 *
	 * It is the inherited `cwd` that changes meaning here: on a detail it is
	 * the AGENT's working directory, read from its transcript. An agent that
	 * `cd`s in a tool call moves independently of the shell it was launched
	 * from, and the header should say where the work is. `cwd` falls back to
	 * this field when the transcript never said.
	 */
	paneCwd: string;
	/**
	 * The git state of `cwd` above — branch plus drift from its upstream.
	 * Detail only: the list would pay a git call per row for it, and a row
	 * already has the cwd it would be describing.
	 */
	branch: string;
	ahead: number;
	behind: number;
	/** That branch on GitHub, for the header to link to. Empty when unknown. */
	branchUrl: string;
	messages: Message[];
	/**
	 * Sub-agents this session has spawned, newest activity first.
	 *
	 * Each has its own transcript, so a Task row can point at one and the
	 * phone can open it. Empty for a session that has never spawned one, and
	 * for every harness other than Claude Code.
	 */
	subagents: SubagentSummary[];
	picker: Picker | null;
	/**
	 * Why `messages` is scraped pane text rather than a parsed transcript;
	 * 'none' means the transcript rendered. Each rung has a different remedy
	 * (install an adapter, run `herdr integration install`, fix permissions,
	 * update bordr), so the reason must reach the operator, not just the fact.
	 */
	degraded: 'none' | 'no-adapter' | 'no-session' | 'stale-session' | 'unreadable' | 'empty';
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
	/** How herdr actually arranges those panes; absent if it did not say. */
	layout?: TabLayout;
}

/** One node of a tab's split tree: a pane, or a division into two. */
export type SplitNode =
	| { kind: 'pane'; paneId: string }
	| {
			kind: 'split';
			/** Stacked rather than side by side. */
			vertical: boolean;
			ratio: number;
			/** Which half to descend into at each level — what herdr's layout.set_split_ratio takes. */
			path: boolean[];
			first: SplitNode;
			second: SplitNode;
	  };

export interface TabLayout {
	zoomed: boolean;
	focusedPaneId: string;
	tree: SplitNode;
}

export interface WorkspaceNode {
	workspaceId: string;
	/** The machine this workspace lives on; empty for this host. */
	machine: string;
	label: string;
	number: number;
	focused: boolean;
	/** The git branch of the workspace's directory, as herdr shows it. Empty outside a repo. */
	branch: string;
	/** Commits ahead of the branch's upstream. Zero outside a repo or with no upstream. */
	ahead: number;
	/** Commits behind the branch's upstream. Zero outside a repo or with no upstream. */
	behind: number;
	tabs: TabNode[];
}

export type { Activity };

export type { Machine };

/** A machine and what its connection is doing, for the sidebar. */
export interface MachineStatus {
	machine: Machine;
	state: 'connected' | 'connecting' | 'unreachable';
	error: string | null;
}
