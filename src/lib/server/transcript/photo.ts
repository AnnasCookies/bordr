import { servableUrl } from '../files';
import { fromBlocks, type Adapter, type Block, type Message } from './types';

/**
 * bordr's own photo prompt (see the image route) rendered as what it was on
 * the phone: the photo itself and its caption, not the instruction to the
 * agent. Applied to every adapter's output, since every harness receives the
 * same text.
 */
const PHOTO_PROMPT =
	/^\[The user attached (an image|\d+ images) from their phone:([\s\S]*?)before responding\.\]\s*(?:\n\n([\s\S]*))?$/;

/** The upload paths inside the prompt body. Absolute, one per image. */
const UPLOAD_PATH = /(\/\S+\.(?:png|jpe?g|gif|webp|heic|heif))/gi;

/** The old flat rendering, still used when nothing is servable. */
export function photoMessage(text: string): string | null {
	const photo = PHOTO_PROMPT.exec(text);
	if (!photo) return null;
	const count = photo[1] === 'an image' ? 1 : Number.parseInt(photo[1], 10);
	const caption = photo[3]?.trim();
	const what = count === 1 ? '📷 photo' : `📷 ${count} photos`;
	return caption ? `${what}\n${caption}` : what;
}

/**
 * Blocks for a photo prompt: one image per upload that is still on disk, plus
 * the caption as text.
 *
 * An upload that has been pruned (they age out) resolves to nothing, so the
 * message falls back to the flat "📷 photo" line rather than rendering a
 * broken image.
 */
export function photoBlocks(text: string): Block[] | null {
	const photo = PHOTO_PROMPT.exec(text);
	if (!photo) return null;

	const caption = photo[3]?.trim() ?? '';
	const blocks: Block[] = [];
	for (const match of photo[2].matchAll(UPLOAD_PATH)) {
		const src = servableUrl(match[1]);
		if (src) blocks.push({ kind: 'image', src, caption: '' });
	}
	if (blocks.length === 0) return null;
	if (caption) blocks.push({ kind: 'text', text: caption });
	return blocks;
}

export function withPhotoPrompts(adapter: Adapter): Adapter {
	return {
		resolve: (sessionId) => adapter.resolve(sessionId),
		parse(jsonl: string): Message[] {
			return adapter.parse(jsonl).map((message) => {
				if (message.role !== 'user') return message;
				const blocks = photoBlocks(message.text);
				if (blocks) return fromBlocks('user', blocks);
				const text = photoMessage(message.text);
				return text === null ? message : { ...message, text, blocks: [{ kind: 'text', text }] };
			});
		}
	};
}
