import type { AgentStatus } from '$lib/types';
import type { Message } from './transcript/types';

/** Pi's live footer while a turn is running: `── ⠹ Working ─────`. */
const PI_WORKING_ROW = /^[─━]+\s+\S+\s+Working\b/imu;

export function piScreenWorking(visible: string): boolean {
	return PI_WORKING_ROW.test(visible);
}

/** Whether the transcript has reached a finished assistant reply. */
export function piTranscriptSettled(messages: Message[]): boolean {
	const last = messages.at(-1);
	return last?.role === 'assistant' && last.text.trim().length > 0;
}

/**
 * Repair Pi's occasional missed idle report without second-guessing real work.
 *
 * Herdr remains authoritative except for one proved contradiction: it says
 * working, Pi's live screen has no Working row, and the transcript ends in a
 * finished assistant reply. During a new turn either the transcript ends with
 * the user's prompt or Pi paints its Working row, so neither signal alone can
 * incorrectly flip the pane to idle.
 */
export function reconcilePiStatus(
	agent: string,
	status: AgentStatus,
	screenWorking: boolean,
	transcriptSettled: boolean
): AgentStatus {
	if (agent !== 'pi' || status !== 'working' || !transcriptSettled) return status;
	return screenWorking ? status : 'idle';
}
