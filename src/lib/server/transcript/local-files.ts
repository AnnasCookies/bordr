import { servableUrl } from '../files';
import type { Adapter, Block, Message } from './types';

/**
 * Point a markdown image or link at a path bordr can actually serve.
 *
 * An agent writes absolute paths, because that is what it works with:
 * `![chart](/home/you/repos/out.png)`. Left alone the phone requests
 * `/home/you/repos/out.png` from bordr and gets a 404 — a broken image icon
 * where a picture should be.
 *
 * Rewritten to `/raw/<root>/…` when the file sits inside a configured file
 * root, which is the same confinement the Files tab uses; a path outside
 * every root is left exactly as written, so it reads as the path it is
 * rather than pretending to be a link.
 */
const MD_IMAGE = /(!?)\[([^\]]*)\]\((\/[^)\s]+)\)/g;

export function rewriteLocalPaths(text: string): string {
	return text.replace(MD_IMAGE, (whole, bang: string, label: string, path: string) => {
		const url = servableUrl(decodeURI(path));
		if (!url) return whole;
		// A link to a file opens the viewer, which can page images, render
		// markdown and offer a download; an image renders in place.
		return bang ? `![${label}](${url})` : `[${label}](${url.replace(/^\/raw\//, '/f/')})`;
	});
}

export function withLocalFiles(adapter: Adapter): Adapter {
	return {
		resolve: (sessionId) => adapter.resolve(sessionId),
		parse(jsonl: string): Message[] {
			return adapter.parse(jsonl).map((message) => {
				if (!message.blocks?.some((b) => b.kind === 'text')) return message;
				const blocks: Block[] = message.blocks.map((block) =>
					block.kind === 'text' ? { kind: 'text', text: rewriteLocalPaths(block.text) } : block
				);
				return { ...message, blocks };
			});
		}
	};
}
