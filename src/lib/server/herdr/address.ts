/**
 * A pane's address: which machine, and which pane on it.
 *
 * Local panes keep their bare herdr id — `w3:p1` — so every URL, read-state
 * key and push-dedupe entry that already exists keeps working untouched.
 * A pane on another machine is prefixed with that machine's id:
 * `tm-dev/w8:p1`. herdr pane ids never contain a slash, so the split is
 * unambiguous.
 */
export interface PaneAddress {
	/** Empty for this host. */
	machineId: string;
	/** The id herdr itself uses, always without a prefix. */
	paneId: string;
}

export function parsePane(address: string): PaneAddress {
	const slash = address.indexOf('/');
	if (slash === -1) return { machineId: '', paneId: address };
	return { machineId: address.slice(0, slash), paneId: address.slice(slash + 1) };
}

export function formatPane(machineId: string, paneId: string): string {
	return machineId ? `${machineId}/${paneId}` : paneId;
}

export function isRemote(address: string): boolean {
	return address.includes('/');
}
