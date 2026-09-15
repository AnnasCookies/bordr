import { slashCommandName } from '$lib/commands';

export interface CommandReceipt {
	name: string;
	outcome: 'accepted' | 'confirmed';
	message: string;
}

const RELOADING =
	'Reloading keybindings, extensions, skills, prompts, themes, and context files...';
const RELOADED = 'Reloaded keybindings, extensions, skills, prompts, themes, and context files';
export const RECEIPT_DEADLINE_MS = 5_000;

/** Positive native Pi success after progress, within one elapsed deadline including reads. */
export async function commandReceipt(
	text: string,
	readScreen: () => Promise<string>,
	pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<CommandReceipt | null> {
	const name = slashCommandName(text);
	if (!name) return null;
	if (name !== 'reload') return { name, outcome: 'accepted', message: `✓ /${name} accepted` };
	let reloading = false;
	let priorSuccesses = 0;
	const deadline = Date.now() + RECEIPT_DEADLINE_MS;
	for (let sample = 0; sample < 25 && Date.now() < deadline; sample++) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const screen = await Promise.race([
				readScreen(),
				new Promise<null>((resolve) => {
					timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
				})
			]);
			if (screen === null) break;
			if (/Reload failed:|models\.json error:/i.test(screen)) break;
			const successes = screen.split(RELOADED).length - 1;
			if (screen.includes(RELOADING)) {
				reloading = true;
				priorSuccesses = Math.max(priorSuccesses, successes);
			} else if (reloading && successes > priorSuccesses)
				return { name, outcome: 'confirmed', message: '✓ Reload complete' };
		} catch {
			break;
		} finally {
			// Delivery succeeded; observation failure cannot delay its acknowledgment.
			clearTimeout(timer);
		}
		await pause(Math.min(200, Math.max(0, deadline - Date.now())));
	}
	return { name, outcome: 'accepted', message: '→ /reload sent' };
}
