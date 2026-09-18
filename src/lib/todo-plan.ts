export type TodoStatus = 'completed' | 'in_progress' | 'pending' | 'blocked' | 'abandoned';

export interface TodoPlanItem {
	content: string;
	status: TodoStatus;
	note?: string;
}

export interface TodoPlanPhase {
	name: string;
	items: TodoPlanItem[];
}

export interface TodoPlan {
	completed: number;
	abandoned: number;
	closed: number;
	total: number;
	open: number;
	blocked: number;
	activePhase: string | null;
	activePhaseIndex: number;
	phaseCount: number;
	phases: TodoPlanPhase[];
}

const STATUSES = new Set<TodoStatus>([
	'completed',
	'in_progress',
	'pending',
	'blocked',
	'abandoned'
]);
const OVERALL = /^Overall:\s+(\d+)\/(\d+) done,\s+(\d+) open(?:,\s+(\d+) blocked)?\.$/m;
const ACTIVE = /^Active phase\s+(\d+)\/(\d+)\s+"([^"]+)"\s+\(\d+\/\d+\)(?:\.|\s+—.*)?$/m;
const PHASE = /^ {2}([^-\s].*):$/;
const ITEM = /^ {4}- \[([Xx ])\] (.+)$/;
const STATE = / \((in progress|pending|dropped|blocked(?:: (.*))?)\)$/;
const PI_CREATED = /^Created #(\d+)\b/m;
const PI_LIST_ITEM = /^\[(pending|in_progress|completed|deleted)\]\s+#(\d+)\s+(.+)$/;

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function summarise(phases: TodoPlanPhase[]): TodoPlan {
	const items = phases.flatMap((phase) => phase.items);
	const completed = items.filter((item) => item.status === 'completed').length;
	const abandoned = items.filter((item) => item.status === 'abandoned').length;
	const open = items.filter(
		(item) => item.status === 'pending' || item.status === 'in_progress'
	).length;
	const blocked = items.filter((item) => item.status === 'blocked').length;
	let active = phases.findIndex((phase) =>
		phase.items.some((item) => item.status === 'pending' || item.status === 'in_progress')
	);
	if (active < 0)
		active = phases.findIndex((phase) => phase.items.some((item) => item.status === 'blocked'));
	if (active < 0 && phases.length > 0) active = phases.length - 1;

	return {
		completed,
		abandoned,
		closed: completed + abandoned,
		total: items.length,
		open,
		blocked,
		activePhase: phases[active]?.name ?? null,
		activePhaseIndex: active + 1,
		phaseCount: phases.length,
		phases
	};
}

/**
 * Pi's todo tool records one mutation at a time, unlike OMP's full snapshot.
 * Replay those calls while parsing the transcript so Bordr can render the same
 * plan card instead of a run of generic `todo update` tool rows.
 */
export class PiTodoTracker {
	private tasks = new Map<number, TodoPlanItem>();

	apply(input: Record<string, unknown> | null, result: string): TodoPlan | null {
		if (!input || typeof input.action !== 'string') return this.plan();
		const action = input.action;

		if (action === 'create') {
			const id = Number(PI_CREATED.exec(result)?.[1]);
			const content = typeof input.subject === 'string' ? input.subject.trim() : '';
			if (Number.isInteger(id) && content) this.tasks.set(id, { content, status: 'pending' });
		} else if (action === 'update') {
			const id = typeof input.id === 'number' ? input.id : Number(input.id);
			const current = this.tasks.get(id);
			if (current) {
				const content =
					typeof input.subject === 'string' && input.subject.trim()
						? input.subject.trim()
						: current.content;
				const status = input.status;
				if (status === 'deleted') this.tasks.delete(id);
				else if (status === 'pending' || status === 'in_progress' || status === 'completed') {
					this.tasks.set(id, { content, status });
				} else if (content !== current.content) {
					this.tasks.set(id, { ...current, content });
				}
			}
		} else if (action === 'delete') {
			const id = typeof input.id === 'number' ? input.id : Number(input.id);
			if (Number.isInteger(id)) this.tasks.delete(id);
		} else if (action === 'clear') {
			this.tasks.clear();
		} else if (action === 'list') {
			const listed = new Map<number, TodoPlanItem>();
			for (const line of result.split('\n')) {
				const match = PI_LIST_ITEM.exec(line.trim());
				if (!match || match[1] === 'deleted') continue;
				const status = match[1] as Exclude<TodoStatus, 'blocked' | 'abandoned'>;
				// In-progress list rows append the spinner label in parentheses.
				const content =
					status === 'in_progress' ? match[3].replace(/\s+\([^()]+\)$/, '') : match[3];
				listed.set(Number(match[2]), { content, status });
			}
			// An unfiltered list is authoritative. Filtered lists only add what
			// they know, otherwise asking for pending work would erase completed work.
			if (input.status === undefined) this.tasks = listed;
			else for (const [id, item] of listed) this.tasks.set(id, item);
		}

		return this.plan();
	}

	private plan(): TodoPlan | null {
		if (this.tasks.size === 0) return null;
		return summarise([{ name: 'Tasks', items: [...this.tasks.values()] }]);
	}
}

/** Validate and normalise the canonical TodoToolDetails stored by OMP. */
export function todoPlanFromDetails(details: unknown): TodoPlan | null {
	const value = record(details);
	if (!value || !Array.isArray(value.phases)) return null;

	const phases: TodoPlanPhase[] = [];
	for (const rawPhase of value.phases) {
		const phase = record(rawPhase);
		if (!phase || typeof phase.name !== 'string' || !phase.name || !Array.isArray(phase.tasks)) {
			return null;
		}

		const items: TodoPlanItem[] = [];
		for (const rawTask of phase.tasks) {
			const task = record(rawTask);
			if (
				!task ||
				typeof task.content !== 'string' ||
				!task.content ||
				typeof task.status !== 'string' ||
				!STATUSES.has(task.status as TodoStatus)
			) {
				return null;
			}
			const status = task.status as TodoStatus;
			items.push({
				content: task.content,
				status,
				...(status === 'blocked' && typeof task.blocker === 'string' && task.blocker
					? { note: task.blocker }
					: {})
			});
		}
		phases.push({ name: phase.name, items });
	}

	return summarise(phases);
}

/** Legacy fallback for OMP transcripts written before TodoToolDetails existed. */
export function parseTodoPlan(text: string): TodoPlan | null {
	const overall = OVERALL.exec(text);
	if (!overall) return null;

	const active = ACTIVE.exec(text);
	const phases: TodoPlanPhase[] = [];
	let phase: TodoPlanPhase | null = null;

	for (const line of text.split('\n')) {
		const phaseMatch = PHASE.exec(line);
		if (phaseMatch) {
			phase = { name: phaseMatch[1], items: [] };
			phases.push(phase);
			continue;
		}

		const itemMatch = ITEM.exec(line);
		if (!phase || !itemMatch) continue;

		let content = itemMatch[2];
		const stateMatch = STATE.exec(content);
		if (stateMatch) content = content.slice(0, -stateMatch[0].length);

		let status: TodoStatus = itemMatch[1].toLowerCase() === 'x' ? 'completed' : 'pending';
		if (stateMatch?.[1] === 'in progress') status = 'in_progress';
		else if (stateMatch?.[1] === 'dropped') status = 'abandoned';
		else if (stateMatch?.[1]?.startsWith('blocked')) status = 'blocked';

		phase.items.push({
			content,
			status,
			...(status === 'blocked' && stateMatch?.[2] ? { note: stateMatch[2] } : {})
		});
	}

	const plan = summarise(phases);
	const closed = Number(overall[1]);
	if (plan.abandoned > closed) return null;
	return {
		...plan,
		completed: closed - plan.abandoned,
		closed,
		total: Number(overall[2]),
		open: Number(overall[3]),
		blocked: Number(overall[4] ?? 0),
		activePhase: active?.[3] ?? plan.activePhase,
		activePhaseIndex: Number(active?.[1] ?? plan.activePhaseIndex),
		phaseCount: Number(active?.[2] ?? plan.phaseCount)
	};
}
