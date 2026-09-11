/**
 * A pane's address: which machine, and which pane on it.
 *
 * Local panes keep their bare herdr id — `w3:p1` — so every URL, read-state
 * key and push-dedupe entry that already exists keeps working untouched.
 * A pane on another machine is prefixed with that machine's id:
 * `tm-dev~w8:p1`.
 *
 * The separator is `~`, not `/`. A slash is the one character that changes
 * meaning in a URL path: `resolve('/a/[pane]', …)` does not escape it, so a
 * link came out as `/a/<machine>/<pane>` — two segments, matching no route,
 * and every remote pane 404'd on tap. `~` is unreserved in RFC 3986, needs
 * no encoding anywhere, and appears in neither a herdr pane id nor a machine
 * id.
 */
const SEPARATOR = '~';
export interface PaneAddress {
	/** Empty for this host. */
	machineId: string;
	/** The id herdr itself uses, always without a prefix. */
	paneId: string;
}

export function parsePane(address: string): PaneAddress {
	const at = address.indexOf(SEPARATOR);
	if (at === -1) return { machineId: '', paneId: address };
	return { machineId: address.slice(0, at), paneId: address.slice(at + 1) };
}

export function formatPane(machineId: string, paneId: string): string {
	return machineId ? `${machineId}${SEPARATOR}${paneId}` : paneId;
}

export function isRemote(address: string): boolean {
	return address.includes(SEPARATOR);
}
