const MAX_AGENT_NAME = 32;

/** Convert a display label into the strict name Herdr accepts for agent.start. */
export function herdrAgentName(label: string | undefined, kind: string): string {
	const fallback = kind.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'agent';
	let name = (label?.trim() || fallback)
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[’']/g, '')
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^[-_]+|[-_]+$/g, '');

	if (!/^[a-z]/.test(name)) name = `${fallback}-${name}`;
	name = name.slice(0, MAX_AGENT_NAME).replace(/[-_]+$/g, '');
	return name || fallback.slice(0, MAX_AGENT_NAME) || 'agent';
}

/** A deterministic second choice when another live agent already uses the label. */
export function uniqueHerdrAgentName(name: string, paneId: string): string {
	const suffix = `-${paneId.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
	const base = name.slice(0, MAX_AGENT_NAME - suffix.length).replace(/[-_]+$/g, '');
	return `${base || 'agent'}${suffix}`.slice(0, MAX_AGENT_NAME);
}
