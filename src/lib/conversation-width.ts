import type { ConversationWidth } from './prefs.svelte';

/**
 * The width classes for the transcript, its banners and the composer.
 *
 * One definition because all three have to agree: a composer that stops
 * 300px short of the transcript above it reads as a bug, and they were three
 * separate copies of the same class list waiting to drift apart.
 *
 * Phones are unaffected — every variant below starts at `lg`.
 */
export function widthClasses(width: ConversationWidth): string {
	if (width === 'full') return 'max-w-screen-sm lg:max-w-none';
	if (width === 'wide') return 'max-w-screen-sm lg:max-w-4xl xl:max-w-6xl 2xl:max-w-7xl';
	return 'max-w-screen-sm lg:max-w-3xl xl:max-w-4xl 2xl:max-w-5xl';
}
