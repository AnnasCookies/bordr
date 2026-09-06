export interface ToolCall {
	name: string;
	summary: string;
}

export interface Message {
	role: 'user' | 'assistant' | 'system';
	text: string;
	tools: ToolCall[];
	/**
	 * A question the harness asked through a tool rather than a dialog
	 * (codex's request_user_input): the phone answers it by typing the
	 * option back, so the options travel with the message.
	 */
	ask?: { question: string; options: string[] };
}

export interface Adapter {
	/** Absolute path to the transcript for this session id, or null if absent. */
	resolve(sessionId: string): Promise<string | null>;
	parse(jsonl: string): Message[];
}
