const ESC = '\x1b';

/**
 * herdr-core's first paint, as the text-with-colour lines the TUI's
 * `agent.read --format ansi` gave.
 *
 * Measured on core 0.1.17: the paint resets modes, clears, sets tab stops
 * (`CSI n G` + `ESC H`), homes the cursor, then draws every row separated by
 * CRLF, then puts the cursor back (`CSI r;c H`) and reports title, status and
 * mode 9001. So: start after the last bare home before the first row, keep
 * SGR (colour), drop every other control sequence.
 */
/* eslint-disable no-control-regex -- matching terminal output means matching escapes */
export function paintToScreen(paint: string): string {
	const firstRow = paint.indexOf('\r\n');
	const head = firstRow === -1 ? paint : paint.slice(0, firstRow);
	const home = head.lastIndexOf(`${ESC}[H`);
	const body = home === -1 ? paint : paint.slice(home + 3);
	return (
		body
			// OSC (title, 7501 status, links): ST or BEL terminated
			.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
			// CSI that is not SGR: cursor moves, modes, kitty keyboard. A private
			// marker makes even an `m` something else (`CSI > 4;2 m` is a key mode).
			.replace(/\x1b\[[0-9;?<=>!]*[A-Za-ln-z]/g, '')
			.replace(/\x1b\[[?<=>!][0-9;]*m/g, '')
			// two-byte escapes: charset (`ESC ( B`), tab set (`ESC H`), keypad
			.replace(/\x1b[()][0-9A-Za-z]/g, '')
			.replace(/\x1b[HMNOP=>78c]/g, '')
			.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1a\x1c-\x1f]/g, '')
			.split('\r\n')
			.map((line) => line.replace(/\r/g, ''))
			.join('\n')
	);
}
/* eslint-enable no-control-regex */
