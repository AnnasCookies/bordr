<script lang="ts">
	import { prefs } from '$lib/prefs.svelte';
	import { followPointer } from '$lib/pointer-drag';
	import { clampSidebar } from '$lib/sidebar';

	/**
	 * The grab strip down the sidebar's right edge.
	 *
	 * Pointer events rather than mouse ones, so a trackpad and a touchscreen
	 * drag it too, followed through the same helper as the divider inside the
	 * sidebar. This strip used to carry its own copy and repeated all three of
	 * the bugs that divider had been fixed for: listeners on the window, no
	 * `pointercancel`, and no `touch-action: none` — so on a touchscreen laptop
	 * a drag the browser cancelled left the window listening, and later
	 * movement anywhere resized the sidebar.
	 *
	 * A button rather than `role="separator"` for the same reason as that one:
	 * a focusable separator with aria-valuenow is the correct splitter
	 * pattern, but svelte-check treats every separator as decorative and warns
	 * either way. A button is announced as the control it is and keeps the
	 * keyboard.
	 */
	let { onreset }: { onreset?: () => void } = $props();

	const STEP = 24;

	/** Live width while dragging; null when the pref is in charge. */
	let dragWidth = $state<number | null>(null);
	const width = $derived(dragWidth ?? prefs.value.sidebarWidth);

	/**
	 * The width is held here while dragging and written once, on release:
	 * `prefs.set` serialises the whole preferences object into localStorage,
	 * synchronously, and this used to do that on every pointermove.
	 *
	 * The page sizes the sidebar from the pref, which does not change until
	 * then, so the drag sets the sidebar's own width in the meantime. Release
	 * stores that same value, so the page's binding takes over without a jump.
	 */
	function startDrag(event: PointerEvent, handle: HTMLElement) {
		const sidebar = handle.parentElement;
		if (!sidebar) return;
		event.preventDefault();
		// Measured from the sidebar's own left edge, so the width follows the
		// pointer exactly rather than drifting by wherever the grab started.
		const left = sidebar.getBoundingClientRect().left;
		document.body.style.userSelect = 'none';

		followPointer(handle, event.pointerId, {
			move: (at) => {
				dragWidth = clampSidebar(at.clientX - left);
				sidebar.style.width = `${dragWidth}px`;
			},
			end: () => {
				document.body.style.userSelect = '';
				if (dragWidth !== null) prefs.set('sidebarWidth', dragWidth);
				dragWidth = null;
			}
		});
	}
</script>

<!--
	touch-none in CSS, not preventDefault() in the listener: the browser decides
	whether a touch scrolls before any listener runs.
-->
<button
	type="button"
	aria-label="Resize the sidebar, currently {width}px — arrow keys adjust, double-click resets"
	class="group absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize touch-none before:absolute before:-inset-x-2 before:inset-y-0 before:content-['']"
	onpointerdown={(e) => startDrag(e, e.currentTarget)}
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
