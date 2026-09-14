const PREFIX = 'bordr-draft:';

export interface DraftStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export interface SessionDraftStore {
	load(paneId: string): string;
	schedule(paneId: string, draft: string): void;
	clear(paneId: string): void;
	restore(paneId: string, draft: string): string;
	flush(): void;
}

/**
 * Keeps one unsent composer draft per pane without writing on every keystroke.
 * Storage is best effort: private browsing or a full quota must not break chat.
 */
export function createSessionDraftStore(storage: DraftStorage, delay = 300): SessionDraftStore {
	let activePaneId = '';
	let activeDraft = '';
	let timer: ReturnType<typeof setTimeout> | undefined;

	function key(paneId: string): string {
		return `${PREFIX}${paneId}`;
	}

	function cancelTimer() {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	}

	function write(paneId: string, draft: string) {
		try {
			if (draft) storage.setItem(key(paneId), draft);
			else storage.removeItem(key(paneId));
		} catch {
			// Persistence is optional; the composer must still work without storage.
		}
	}

	function flush() {
		if (!activePaneId) return;
		cancelTimer();
		write(activePaneId, activeDraft);
	}

	function selectPane(paneId: string) {
		if (activePaneId && activePaneId !== paneId) flush();
		activePaneId = paneId;
	}

	return {
		load(paneId: string): string {
			selectPane(paneId);
			try {
				activeDraft = storage.getItem(key(paneId)) ?? '';
			} catch {
				activeDraft = '';
			}
			return activeDraft;
		},

		schedule(paneId: string, draft: string) {
			if (activePaneId === paneId && activeDraft === draft) return;
			selectPane(paneId);
			activeDraft = draft;
			cancelTimer();
			timer = setTimeout(() => {
				timer = undefined;
				write(paneId, draft);
			}, delay);
		},

		clear(paneId: string) {
			if (activePaneId === paneId) {
				cancelTimer();
				activeDraft = '';
			}
			write(paneId, '');
		},

		restore(paneId: string, draft: string): string {
			const isActivePane = activePaneId === paneId;
			let current = '';
			if (isActivePane) {
				cancelTimer();
				current = activeDraft;
			} else {
				try {
					current = storage.getItem(key(paneId)) ?? '';
				} catch {
					// The failed text is still returned to an active composer below.
				}
			}
			const restored = current ? `${draft}\n${current}` : draft;
			if (isActivePane) activeDraft = restored;
			write(paneId, restored);
			return restored;
		},

		flush
	};
}
