/**
 * A model name without the vendor it is already sitting next to.
 *
 * The harness mark is immediately to its left, so `claude-opus-5` spends
 * about 45px of a phone header saying "claude" a second time. On a 390px
 * screen that row has 234px for five things and the branch had already been
 * squeezed to nothing — the prefix was the cheapest 45px in the header.
 *
 * Only the leading harness name comes off, and only when something is left
 * behind: what remains has to stay a name you can tell from another one.
 * `claude-opus-5` becomes `opus-5`, which is still not `opus`. A model called
 * exactly `claude` keeps its name rather than becoming nothing.
 */
export function shortModel(model: string, agent: string): string {
	const name = model.trim();
	const vendor = agent.trim().toLowerCase();
	if (!name || !vendor) return name;
	const lower = name.toLowerCase();
	// A separator is required: `claudette-1` does not start with the vendor in
	// any sense worth cutting, and `claude` alone has nothing after it.
	for (const sep of ['-', ' ', '/', '_']) {
		const prefix = `${vendor}${sep}`;
		if (lower.startsWith(prefix) && name.length > prefix.length) return name.slice(prefix.length);
	}
	return name;
}
