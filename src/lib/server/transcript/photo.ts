import type { Adapter, Message } from './types';

/**
 * bordr's own photo prompt (see the image route) rendered as what it was on
 * the phone: a photo and a caption, not the instruction to the agent. Applied
 * to every adapter's output, since every harness receives the same text.
 */
const PHOTO_PROMPT =
	/^\[The user attached (an image|\d+ images) from their phone:[\s\S]*?before responding\.\]\s*(?:\n\n([\s\S]*))?$/;

export function photoMessage(text: string): string | null {
	const photo = PHOTO_PROMPT.exec(text);
	if (!photo) return null;
	const count = photo[1] === 'an image' ? 1 : Number.parseInt(photo[1], 10);
	const caption = photo[2]?.trim();
	const what = count === 1 ? '📷 photo' : `📷 ${count} photos`;
	return caption ? `${what}\n${caption}` : what;
}

export function withPhotoPrompts(adapter: Adapter): Adapter {
	return {
		resolve: (sessionId) => adapter.resolve(sessionId),
		parse(jsonl: string): Message[] {
			return adapter.parse(jsonl).map((message) => {
				if (message.role !== 'user') return message;
				const text = photoMessage(message.text);
				return text === null ? message : { ...message, text };
			});
		}
	};
}
