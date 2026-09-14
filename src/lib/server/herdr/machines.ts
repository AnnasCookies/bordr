import { env } from '$env/dynamic/private';
import { ALLOW_FLAG, machinesInherit } from '../bind';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Machine {
	id: string;
	label: string;
	/** The SSH target herdr connects to. */
	target: string;
	/** The herdr session on that host. */
	session: string;
	enabled: boolean;
}

/**
 * The SSH machines herdr knows about.
 *
 * Read from herdr's own client state rather than asked for over the socket,
 * because the socket has no machine concept at all — all 103 methods
 * enumerated, none of them about machines. Machines are a herdr CLIENT
 * feature: the TUI opens its own connection to each host's herdr server.
 *
 * So this list is informational. bordr binds one socket and serves the panes
 * on this host; a machine's panes live on that machine's own server and are
 * not reachable from here. Showing the list is still worth it — "where are my
 * other machines" is a real question, and answering it honestly beats leaving
 * the sidebar silent about them.
 */
function endpointsPath(): string {
	return (
		env.HERDR_ENDPOINTS ||
		join(
			process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'),
			'herdr',
			'client',
			'endpoints.json'
		)
	);
}

export function listMachines(): Machine[] {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(endpointsPath(), 'utf8'));
	} catch {
		// No file is the normal case for anyone who has never added one.
		return [];
	}
	const ssh = (raw as { ssh?: unknown })?.ssh;
	if (!Array.isArray(ssh)) return [];

	const machines = ssh
		.map((entry) => entry as Record<string, unknown>)
		.filter((entry) => typeof entry.label === 'string' && entry.label)
		.map((entry) => ({
			id: String(entry.id ?? entry.label),
			label: String(entry.label),
			target: String(entry.target ?? ''),
			session: String(entry.session ?? 'default'),
			enabled: entry.enabled !== false
		}));

	// `BORDR_MACHINES` NARROWS the list; it no longer switches it on.
	//
	// Naming a machine in herdr is a deliberate act at a terminal, and when
	// bordr is reachable by nobody that terminal is not — bound to loopback or
	// a tailnet, with the no-auth flag unset — the two grants are the same
	// grant, and a second list is bookkeeping that duplicates the first. That
	// is what `machinesInherit` decides; see its comment for the case it
	// cannot see, and what shuts that one out.
	//
	// Set the list and it still does exactly what it did: only these. Which is
	// what you want when the tailnet is shared, or bordr has been bound
	// somewhere deliberately.
	const allowed = (env.BORDR_MACHINES ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	if (allowed.length === 0) {
		return machinesInherit(env.HOST, env[ALLOW_FLAG], env.BORDR_ALLOWED_HOSTS) ? machines : [];
	}

	return machines.filter(
		(machine) =>
			allowed.includes(machine.id.toLowerCase()) || allowed.includes(machine.label.toLowerCase())
	);
}

/**
 * The machines herdr knows about, whether or not bordr may reach them.
 *
 * Only for explaining an empty list. A sidebar that simply omits the two
 * hosts you use every day reads as bordr having lost them, and the actual
 * answer — an allowlist that was never set — is invisible: it lives in a file
 * the app never mentions. Names only; nothing here is connected to.
 */
export function knownMachineLabels(): string[] {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(endpointsPath(), 'utf8'));
	} catch {
		return [];
	}
	const ssh = (raw as { ssh?: unknown })?.ssh;
	if (!Array.isArray(ssh)) return [];
	return ssh
		.map((entry) => (entry as Record<string, unknown>).label)
		.filter((label): label is string => typeof label === 'string' && label.length > 0);
}
