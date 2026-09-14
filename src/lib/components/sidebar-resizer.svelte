<script lang="ts">
	import { prefs } from '$lib/prefs.svelte';
	import { clampSidebar } from '$lib/sidebar';

	/**
	 * The grab strip down the sidebar's right edge.
	 *
	 * Pointer events rather than mouse ones, so a trackpad and a touchscreen
	 * drag it too, and pointer capture so the drag survives the pointer
	 * leaving a 4px strip — the same arrangement the divider inside the
	 * sidebar already uses.
	 *
	 * A button rather than `role="separator"` for the same reason as that one:
	 * a focusable separator with aria-valuenow is the correct splitter
	 * pattern, but svelte-check treats every separator as decorative and warns
	 * either way. A button is announced as the control it is and keeps the
	 * keyboard.
	 */
	let { onreset }: { onreset?: () => void } = $props();

	const STEP = 24;

	function startDrag(event: PointerEvent) {
		event.preventDefault();
		const handle = event.target as HTMLElement;
		handle.setPointerCapture(event.pointerId);
		// Measured from the sidebar's own left edge, so the width follows the
		// pointer exactly rather than drifting by wherever the grab started.
		const left = handle.parentElement?.getBoundingClientRect().left ?? 0;
		document.body.style.userSelect = 'none';

		const move = (e: PointerEvent) => prefs.set('sidebarWidth', clampSidebar(e.clientX - left));
		const stop = (e: PointerEvent) => {
			handle.releasePointerCapture(e.pointerId);
			document.body.style.userSelect = '';
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', stop);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', stop);
	}
</script>

<button
	type="button"
	aria-label="Resize the sidebar, currently {prefs.value
		.sidebarWidth}px — arrow keys adjust, double-click resets"
	class="group absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize before:absolute before:-inset-x-2 before:inset-y-0 before:content-['']"
	onpointerdown={startDrag}
	ondblclick={onreset}
	onkeydown={(e) => {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		prefs.set(
			'sidebarWidth',
			clampSidebar(prefs.value.sidebarWidth + (e.key === 'ArrowRight' ? STEP : -STEP))
		);
	}}
>
	<span
		class="pointer-events-none absolute inset-y-0 right-0 w-[2px] bg-transparent group-hover:bg-working group-focus-visible:bg-working"
	></span>
</button>
