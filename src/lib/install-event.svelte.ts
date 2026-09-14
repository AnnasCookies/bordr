/**
 * The browser's install offer, caught once for the whole app.
 *
 * Chromium fires `beforeinstallprompt` at most once per page load, whenever it
 * decides the site is installable. The install banner lives only on `/`, and
 * it used to listen from its own `onMount` — so the event was missed if it
 * fired before `/` hydrated, or while a pane was open (a cold start from a
 * notification lands on a pane), and a stashed event that had already been
 * `preventDefault`ed was dropped the moment you left `/`, with the browser's
 * own mini-infobar suppressed and nothing to replace it.
 *
 * So the listener is registered by the root layout, which is on every route
 * and outlives every navigation, and the event is held here at module scope
 * for the banner to read whenever it mounts.
 */

export interface InstallEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function createInstallCapture() {
	let held = $state<InstallEvent | null>(null);
	let installed = $state(false);
	let listeningOn: EventTarget | null = null;

	const capture = (event: Event) => {
		// Without this Chromium shows its own mini-infobar, and the event is
		// spent — bordr could never raise the dialog from its own button.
		event.preventDefault();
		held = event as InstallEvent;
	};
	const installedNow = () => {
		held = null;
		installed = true;
	};

	function stop() {
		if (!listeningOn) return;
		listeningOn.removeEventListener('beforeinstallprompt', capture);
		listeningOn.removeEventListener('appinstalled', installedNow);
		listeningOn = null;
	}

	return {
		/** A `beforeinstallprompt` in hand, not yet used. */
		get held(): InstallEvent | null {
			return held;
		},
		/** `appinstalled` has fired during this page's life. */
		get installed(): boolean {
			return installed;
		},
		/**
		 * Start listening, and return the teardown.
		 *
		 * Idempotent: the layout can call it on every mount without stacking a
		 * second listener, which would be harmless for the stash but would call
		 * `preventDefault` twice for no reason.
		 */
		listen(target: EventTarget): () => void {
			if (listeningOn === target) return stop;
			stop();
			target.addEventListener('beforeinstallprompt', capture);
			target.addEventListener('appinstalled', installedNow);
			listeningOn = target;
			return stop;
		},
		/** The event can raise the dialog once; after that it is spent. */
		spend() {
			held = null;
		}
	};
}

export const installCapture = createInstallCapture();
