/**
 * Files attached from the phone: what they are stored as, and what the agent
 * is told about them.
 *
 * Any file may be attached. Photos keep their own wording, because
 * `transcript/photo.ts` recognises it to show the photo in the conversation
 * rather than the instruction to the agent; everything else is a "file".
 */

/** Per file. Six of these stay under the adapter's 100M request cap. */
export const MAX_ATTACH_BYTES = 15 * 1024 * 1024;
export const MAX_ATTACH_FILES = 6;

/**
 * The raster types a photo arrives as, and their stored extensions.
 *
 * Also the only uploads ever served back: an SVG or an HTML file can carry
 * script, and served from bordr's own origin it would run with its API.
 */
export const PHOTO_TYPES: Readonly<Record<string, string>> = {
	'image/png': 'png',
	'image/jpeg': 'jpeg',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

/**
 * The name a file is written under, inside the uploads directory.
 *
 * `stamp` makes it unique. A photo is named by its type alone, as it always
 * was. Anything else keeps a cleaned copy of its own name, because the agent
 * reads the path and "quarterly-report.pdf" tells it what it is looking at:
 * the last path segment only, word characters, dots and dashes, never a
 * leading dot, and the end kept when it is long so the extension survives.
 */
export function storedName(file: { name: string; type: string }, stamp: string): string {
	const photo = PHOTO_TYPES[file.type];
	if (photo) return `${stamp}.${photo}`;
	const base = file.name.split(/[\\/]/).pop() ?? '';
	const safe = base
		.normalize('NFKC')
		.replace(/[^\w.-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.slice(-80)
		.replace(/^[.-]+/, '');
	return safe ? `${stamp}-${safe}` : `${stamp}.bin`;
}

/** The prompt that hands the stored paths to the agent, with the caption after it. */
export function attachPrompt(paths: string[], allPhotos: boolean, caption: string): string {
	const one = paths.length === 1;
	const what = allPhotos
		? one
			? 'an image'
			: `${paths.length} images`
		: one
			? 'a file'
			: `${paths.length} files`;
	const where = one ? ` ${paths[0]}` : `\n${paths.map((p) => `- ${p}`).join('\n')}`;
	const verb = allPhotos ? 'view' : 'read';
	const text = `[The user attached ${what} from their phone:${where} — use your file-reading tool to ${verb} ${
		one ? 'it' : 'them'
	} before responding.]`;
	return caption ? `${text}\n\n${caption}` : text;
}
