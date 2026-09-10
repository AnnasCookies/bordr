import { env } from '$env/dynamic/private';
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
	return ssh
		.map((entry) => entry as Record<string, unknown>)
		.filter((entry) => typeof entry.label === 'string' && entry.label)
		.map((entry) => ({
			id: String(entry.id ?? entry.label),
			label: String(entry.label),
			target: String(entry.target ?? ''),
			session: String(entry.session ?? 'default'),
			enabled: entry.enabled !== false
		}));
}
