/**
 * Give a terminal snapshot a real cell width.
 *
 * `1ch` is the advance of "0", which only equals a terminal cell when the
 * element's font is genuinely monospace. Fall back far enough down a font
 * stack and it is not: measured in this app, `ch` came out at 5.50px while the
 * actual advance was 6.62px, so pinning glyphs to `1ch` misaligned a
 * 120-column ruler by twenty cells — worse than leaving it alone.
 *
 * So measure the advance the element really renders at, once, and publish it
 * as `--cell` for the cell spans to use.
 */
export function measureCell(el: HTMLElement): number {
	const probe = document.createElement('span');
	probe.textContent = 'M'.repeat(50);
	probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;left:-9999px';
	el.appendChild(probe);
	const width = probe.getBoundingClientRect().width / 50;
	probe.remove();
	return width;
}

/** Svelte action: keep `--cell` correct for this element's current font. */
export function termGrid(el: HTMLElement) {
	const apply = () => {
		const cell = measureCell(el);
		if (cell > 0) el.style.setProperty('--cell', `${cell}px`);
	};
	apply();
	// Font size is a preference and web fonts land late; re-measure on both.
	const observer = new ResizeObserver(apply);
	observer.observe(el);
	void document.fonts?.ready.then(apply);
	return {
		update: apply,
		destroy: () => observer.disconnect()
	};
}
