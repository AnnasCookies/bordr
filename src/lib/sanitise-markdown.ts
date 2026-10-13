import DOMPurify from 'dompurify';

/** Agent-authored HTML renders in bordr's origin, so it must not borrow app layout or controls. */
export function sanitiseMarkdown(html: string, allowRelative = false): string {
	DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
		if (data.attrName === 'class') {
			data.keepAttr = node.nodeName === 'CODE' && /^language-[\w-]+$/.test(data.attrValue);
		}
	});
	try {
		return DOMPurify.sanitize(html, {
			ALLOWED_TAGS: [
				'p',
				'br',
				'hr',
				'strong',
				'em',
				'del',
				'code',
				'pre',
				'span',
				'div',
				'blockquote',
				'ul',
				'ol',
				'li',
				'a',
				'img',
				'h1',
				'h2',
				'h3',
				'h4',
				'h5',
				'h6',
				'table',
				'thead',
				'tbody',
				'tr',
				'th',
				'td'
			],
			ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'colspan', 'rowspan'],
			// File documents have real sibling links; scheme-bearing URLs still
			// use the same allow-list as transcript output.
			ALLOWED_URI_REGEXP: allowRelative
				? /^(?:https?:|\/(?![/\\])|#|mailto:|(?!(?:[/\\]))[^:]*$)/i
				: /^(?:https?:|\/(?!\/)|#|mailto:)/i,
			FORBID_TAGS: ['style', 'form', 'iframe', 'script', 'object', 'embed'],
			FORBID_ATTR: ['style', 'onerror', 'onload', 'srcset']
		});
	} finally {
		DOMPurify.removeHook('uponSanitizeAttribute');
	}
}
