/**
 * The search box's little query language.
 *
 * Searching every transcript returns too much to read on a phone, and the
 * per-pane cap means a broad term crowds out the session you actually wanted.
 * Narrowing is the fix: quoted phrases for precision, `-word` to drop the
 * noise you keep hitting, and bare words that must ALL appear.
 */
export interface SearchQuery {
	/** Every one of these must appear somewhere in the message. */
	terms: string[];
	/** Every one of these must appear verbatim. */
	phrases: string[];
	/** None of these may appear. */
	exclude: string[];
}

/** A query with nothing positive to look for can only match everything. */
export function isEmptyQuery(query: SearchQuery): boolean {
	return query.terms.length === 0 && query.phrases.length === 0;
}

const TOKEN = /-?"[^"]*"|\S+/g;

export function parseSearchQuery(raw: string): SearchQuery {
	const query: SearchQuery = { terms: [], phrases: [], exclude: [] };
	for (const token of raw.toLowerCase().match(TOKEN) ?? []) {
		const negated = token.startsWith('-') && token.length > 1;
		const body = negated ? token.slice(1) : token;
		const quoted = body.startsWith('"') && body.endsWith('"') && body.length >= 2;
		const value = quoted ? body.slice(1, -1).trim() : body;
		if (!value) continue;
		if (negated) query.exclude.push(value);
		else if (quoted) query.phrases.push(value);
		else query.terms.push(value);
	}
	return query;
}

/**
 * Where to anchor the snippet, or -1 when the message does not match.
 *
 * Returns the EARLIEST hit rather than the first needle's hit, so a snippet
 * for `deploy smoke` opens at whichever word actually appears first.
 */
export function matchIndex(text: string, query: SearchQuery): number {
	const haystack = text.toLowerCase();
	for (const word of query.exclude) {
		if (haystack.includes(word)) return -1;
	}
	let earliest = -1;
	for (const needle of [...query.terms, ...query.phrases]) {
		const at = haystack.indexOf(needle);
		if (at === -1) return -1;
		if (earliest === -1 || at < earliest) earliest = at;
	}
	return earliest;
}

/** The needle to highlight at `matchIndex` — used to size the snippet window. */
export function matchLength(text: string, query: SearchQuery): number {
	const haystack = text.toLowerCase();
	const at = matchIndex(text, query);
	if (at === -1) return 0;
	let longest = 0;
	for (const needle of [...query.terms, ...query.phrases]) {
		if (haystack.indexOf(needle) === at) longest = Math.max(longest, needle.length);
	}
	return longest;
}
