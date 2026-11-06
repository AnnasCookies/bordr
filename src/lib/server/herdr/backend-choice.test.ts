import { describe, expect, it, vi } from 'vitest';
import { chooseSocket, dialogOnScreen } from './index';
vi.mock('./machines', () => ({ listMachines: () => [], setCoreMachines: () => {} }));

describe('chooseSocket', () => {
	const tui = '/home/u/.config/herdr/sessions/main/herdr.sock';
	const core = '/run/user/1000/herdr-core/default.sock';
	const present =
		(...paths: string[]) =>
		(path: string) =>
			paths.includes(path);

	it('keeps a running TUI session when an empty core appears beside it', () => {
		// `hc server status` starts a core on Linux; that must not empty bordr.
		const choice = chooseSocket({ core, tui, exists: present(tui, core) });
		expect(choice.path).toBe(tui);
		expect(choice.note).toMatch(/HERDR_BACKEND=core/);
	});
	it('uses core when it is all there is', () => {
		expect(chooseSocket({ core, tui, exists: present(core) })).toEqual({ path: core });
	});
	it('falls back to the TUI path, for its "not reachable" message, when neither runs', () => {
		expect(chooseSocket({ core, tui, exists: present() })).toEqual({ path: tui });
	});
	it('does as told: HERDR_SOCKET first, then HERDR_BACKEND', () => {
		const exists = present(tui, core);
		expect(chooseSocket({ herdrSocket: '/x.sock', backend: 'core', core, tui, exists }).path).toBe(
			'/x.sock'
		);
		expect(chooseSocket({ backend: 'core', core, tui, exists })).toEqual({ path: core });
		expect(chooseSocket({ backend: 'tui', core, tui, exists: present(core) })).toEqual({
			path: tui
		});
	});
});

describe('dialogOnScreen', () => {
	// copilot 1.0.105 on hc 0.1.18 reports `idle` under this dialog, so core
	// would type a message into it, and Enter would answer "Yes".
	const trust = [
		'╭──────────────────────────────────────────────────────────╮',
		'│ Confirm folder trust                                     │',
		'│                                                          │',
		'│ Do you trust the files in this folder?                   │',
		'│                                                          │',
		'│ ❯ 1. Yes                                                 │',
		'│   2. Yes, and remember this folder for future sessions   │',
		'│   3. No (Esc)                                            │',
		'╰──────────────────────────────────────────────────────────╯'
	].join('\n');

	it("sees copilot's folder-trust dialog", () => {
		expect(dialogOnScreen(trust)).toBe(true);
	});
	it("lets pi's first message through while its start screen shows key hints", () => {
		// pi 1.3.0 on hc 0.1.18: menuFooter takes the hint row for a menu's.
		const start = [
			' ▀▀█  v1.3.0',
			' █▀ █ escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more',
			' Press ctrl+o to show full startup help and loaded resources.',
			' Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.',
			'────────────────────────────────────────',
			'────────────────────────────────────────',
			'~/.cache/bordr-probe',
			'$0.000 (sub) 0.0%/872k (auto)'
		].join('\n');
		expect(dialogOnScreen(start)).toBe(false);
	});
	it('leaves a menu with no readable highlight to core', () => {
		const menu = ['Which one?', '  1. Alpha', '  2. Beta', '', 'Enter to confirm · Esc to cancel'];
		expect(dialogOnScreen(menu.join('\n'))).toBe(false);
	});
	it('lets a reply that merely lists numbered steps through', () => {
		const reply = [
			'● Here is the plan:',
			'  1. Read the config',
			'  2. Fix the parser',
			'  3. Run the tests',
			'',
			'❯ '
		].join('\n');
		expect(dialogOnScreen(reply)).toBe(false);
		expect(dialogOnScreen('')).toBe(false);
	});
});
