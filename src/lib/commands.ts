/**
 * A slash command the composer can offer: a harness built-in, or a skill,
 * command, prompt or plugin the person installed. Shared by the server that
 * discovers them and the composer that ranks them as you type.
 */
export interface SlashCommand {
	/** Without the slash. */
	name: string;
	description: string;
	/** Where it came from, for a small label on the phone. */
	source: 'builtin' | 'skill' | 'command' | 'prompt' | 'plugin';
}

/**
 * Rank for a typed prefix: names that start with it, then names that
 * contain it, then descriptions that do. Within a tier, the harness's own
 * order (built-ins first, then installed, alphabetical).
 */
/**
 * The list is a scroll box, so the cap only exists to bound the DOM. Eight
 * filled less than half of it and never scrolled, which read as "that is all
 * there is" — with 341 commands installed it very much was not.
 */
export function rankCommands(commands: SlashCommand[], typed: string, limit = 60): SlashCommand[] {
	const query = typed.replace(/^\//, '').toLowerCase();
	if (!query) return commands.slice(0, limit);
	const tiers: SlashCommand[][] = [[], [], []];
	for (const command of commands) {
		const name = command.name.toLowerCase();
		if (name.startsWith(query)) tiers[0].push(command);
		else if (name.includes(query)) tiers[1].push(command);
		else if (command.description.toLowerCase().includes(query)) tiers[2].push(command);
	}
	// Within the prefix tier the shortest name first: "/mo" is far more
	// often /model than /mobile, and the harness would complete it that way.
	tiers[0].sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
	return tiers.flat().slice(0, limit);
}
