/**
 * Put text on the clipboard. The async clipboard API only exists in a secure
 * context, and bordr is often reached over plain http on the LAN, so fall back
 * to a hidden textarea and the old copy command there.
 */
export async function copyText(text: string): Promise<boolean> {
	if (navigator.clipboard && window.isSecureContext) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Permission refused: the fallback below can still work.
		}
	}
	// Selecting the text takes focus, so it is handed back afterwards. Left on
	// the page body, the next Enter would no longer be the Copy button's: with a
	// question on screen it would answer that instead.
	const focused = document.activeElement;
	const area = document.createElement('textarea');
	area.value = text;
	// Read-only keeps a phone's keyboard down.
	area.setAttribute('readonly', '');
	// Pinned to a corner, not left where the page ends: focusing it there would
	// scroll the conversation. 16px is the size below which iOS zooms on focus.
	Object.assign(area.style, {
		position: 'fixed',
		top: '0',
		left: '0',
		opacity: '0',
		pointerEvents: 'none',
		fontSize: '16px'
	});
	document.body.append(area);
	area.focus({ preventScroll: true });
	area.select();
	// iOS Safari can ignore select() on a read-only field; it honours a range.
	area.setSelectionRange(0, text.length);
	try {
		return document.execCommand('copy');
	} catch {
		return false;
	} finally {
		area.remove();
		if (focused instanceof HTMLElement && focused.isConnected)
			focused.focus({ preventScroll: true });
	}
}
