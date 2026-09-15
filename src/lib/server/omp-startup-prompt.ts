import { Buffer } from 'node:buffer';

const STARTUP_PROMPT_PREFIX = '__BORDR_INITIAL_PROMPT_V1__:';
const BASE64URL = /^[A-Za-z0-9_-]+$/;

type InputHandler = (event: {
	text: string;
	source: string;
}) => Promise<{ handled: true } | undefined>;

interface OmpExtensionApi {
	on(event: 'input', handler: InputHandler): void;
	sendUserMessage(text: string): Promise<void>;
}

export function encodeOmpStartupPrompt(text: string): string {
	return STARTUP_PROMPT_PREFIX + Buffer.from(text, 'utf8').toString('base64url');
}

function decodeOmpStartupPrompt(text: string): string | undefined {
	if (!text.startsWith(STARTUP_PROMPT_PREFIX)) return;
	const encoded = text.slice(STARTUP_PROMPT_PREFIX.length);
	if (!encoded || !BASE64URL.test(encoded)) return;

	const bytes = Buffer.from(encoded, 'base64url');
	const decoded = bytes.toString('utf8');
	if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) return;
	return decoded;
}

export default function startupPromptExtension(pi: OmpExtensionApi): void {
	pi.on('input', async (event) => {
		if (event.source !== 'interactive') return;
		const prompt = decodeOmpStartupPrompt(event.text);
		if (prompt === undefined) return;

		await pi.sendUserMessage(prompt);
		return { handled: true };
	});
}
