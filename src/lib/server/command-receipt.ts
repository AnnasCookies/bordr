import { slashCommandName } from '$lib/commands';

export interface CommandReceipt {
	name: string;
	outcome: 'accepted' | 'confirmed';
	message: string;
}

const RELOADING =
	'Reloading keybindings, extensions, skills, prompts, themes, and context files...';
const RELOAD_SAMPLES = 25;
const RELOAD_SAMPLE_MS = 200;

/**
 * Turn a terminal-only slash command into an honest browser receipt.
 *
 * Herdr accepting `agent.prompt` proves every command was delivered. Pi's
 * `/reload` also paints a progress line while it reloads; seeing that line
 * appear and then disappear is the only completion signal Pi currently gives
 * outside its TUI. Missing that short signal falls back to "sent", never a
 * made-up success.
 */
export async function commandReceipt(
	text: string,
	readScreen: () => Promise<string>,
	pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<CommandReceipt | null> {
	const name = slashCommandName(text);
	if (!name) return null;
	if (name !== 'reload') {
		return { name, outcome: 'accepted', message: `✓ /${name} accepted` };
	}

	let reloading = false;
	for (let sample = 0; sample < RELOAD_SAMPLES; sample++) {
		try {
			const screen = await readScreen();
			if (screen.includes(RELOADING)) reloading = true;
			else if (reloading) {
				return { name, outcome: 'confirmed', message: '✓ Reload complete' };
			}
		} catch {
			// Delivery already succeeded. A failed screen read only weakens the receipt.
		}
		await pause(RELOAD_SAMPLE_MS);
	}
	return { name, outcome: 'accepted', message: '→ /reload sent' };
}
