import { extractStatusLines } from './status';

/** Lines that are pure TUI furniture — rules, box borders, prompt chrome. */
const CHROME = /^[\s─═━┄┈╌╍_=-]{4,}$|^[╭╰│┌└├┤┬┴┼▔▁]+/;

/**
 * Clean a terminal snapshot for chat-style display: drop horizontal rules
 * and box chrome, drop the status footer (it renders in the header
 * instead), and collapse blank runs. The text stays text — this is a
 * tidy-up, not a parser.
 */
export function cleanSnapshot(visible: string): string {
	const status = new Set(extractStatusLines(visible, 32));
	const kept: string[] = [];
	let blanks = 0;
	for (const line of visible.split('\n')) {
		const trimmed = line.trim().replace(/\s{2,}/g, '  ');
		if (trimmed === '') {
			blanks++;
			if (blanks <= 1) kept.push('');
			continue;
		}
		if (CHROME.test(trimmed)) continue;
		if (status.has(trimmed)) continue;
		blanks = 0; // reset only on KEPT lines, so drops cannot split a blank run
		kept.push(line.trimEnd());
	}
	return kept.join('\n').trim();
}
