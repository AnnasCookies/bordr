const REGISTRATION_DELAYS = [250, 500, 1_000, 1_500, 2_000, 2_500, 3_000];

/** Whether herdr rejected a prompt only because the named agent is still registering. */
export function agentIsRegistering(cause: unknown): boolean {
	return cause instanceof Error && cause.message.includes('not an active named agent');
}

/**
 * Retry only herdr's safe, pre-delivery registration refusal.
 *
 * A failed `agent.prompt` has not accepted the text, so retrying this exact
 * error cannot duplicate a message. Every other error leaves immediately.
 */
export async function promptAfterRegistration(
	send: () => Promise<void>,
	sleep: (ms: number) => Promise<unknown> = (ms) =>
		new Promise((resolve) => setTimeout(resolve, ms)),
	delays: readonly number[] = REGISTRATION_DELAYS
): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await send();
			return;
		} catch (cause) {
			if (!agentIsRegistering(cause) || attempt >= delays.length) throw cause;
			await sleep(delays[attempt]);
		}
	}
}
