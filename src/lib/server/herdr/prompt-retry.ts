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

/**
 * A harness can be visibly ready while Herdr keeps it in `launch_pending`.
 * Terminal input is the same final gesture, and an exact named-agent refusal
 * proves the API did not accept the text, so this fallback cannot duplicate it.
 */
export async function promptWithPaneFallback(options: {
	sendNamed: () => Promise<void>;
	sendPane: () => Promise<void>;
	launchPending?: boolean;
	sleep?: (ms: number) => Promise<unknown>;
	delays?: readonly number[];
}): Promise<void> {
	if (options.launchPending) {
		await options.sendPane();
		return;
	}
	try {
		await promptAfterRegistration(options.sendNamed, options.sleep, options.delays);
	} catch (cause) {
		if (!agentIsRegistering(cause)) throw cause;
		await options.sendPane();
	}
}
