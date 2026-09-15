import type { AgentStatus } from '$lib/types';
import type { Message } from './transcript/types';

/** A recognized busy row is evidence of work; its absence is not evidence of idle. */
export function piScreenWorking(visible: string): boolean {
	return /^[─━]+\s+\S+\s+Working\b/imu.test(visible);
}

export function piTranscriptSettled(messages: Message[]): boolean {
	const last = messages.at(-1);
	return (
		last?.role === 'assistant' &&
		last.stopReason === 'stop' &&
		!messages.some((message) =>
			message.blocks?.some((block) => block.kind === 'tool' && !block.result)
		)
	);
}

/**
 * Pi 0.85.1 can hide/replace its working indicator while streaming; IdleStatus
 * renders blank rows and the editor also accepts steering prompts while busy.
 * No source-verified ready footer exists, so retain lifecycle authority.
 */
/** Retain the stale-report diagnostic without turning a discrepancy into idle. */
export function piStatusDiagnostic(
	agent: string,
	status: AgentStatus,
	screenWorking: boolean,
	transcriptSettled: boolean
): string | undefined {
	return agent === 'pi' && status === 'working' && !screenWorking && transcriptSettled
		? 'Pi recorded a stopped reply, but Herdr still reports working; live readiness is unverified.'
		: undefined;
}
