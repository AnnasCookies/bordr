/** Protocol range bordr has been built and tested against. */
export const MIN_PROTOCOL = 19;
export const MAX_TESTED_PROTOCOL = 22;
/*
 * Raised to 22 for herdr 0.9.0 after reading its release notes for anything
 * touching the socket API bordr reads. One entry does: lifecycle
 * subscriptions no longer replay retained history (#1270), which is handled
 * by subscribing before the snapshot in herdr/index.ts and was already
 * covered defensively by the push watcher's reconcile poll.
 *
 * Exercised live on 0.9.0 across claude, codex, pi and omp panes: agent.list,
 * workspace.list, agent.read (text and ansi), agent.prompt, agent.send_keys
 * and events.subscribe.
 */

export type CompatLevel = 'ok' | 'untested' | 'incompatible' | 'unreachable';

export interface Compatibility {
	level: CompatLevel;
	/** herdr session this bordr is bound to, from the socket path. */
	session?: string;
	version: string | null;
	protocol: number | null;
	message: string | null;
	/** Which herdr answered: the TUI's server, or herdr-core. Core has no layout edits. */
	backend?: 'tui' | 'core';
}

/** herdr-core API generation bordr is written against; core bumps it only on a real break. */
export const CORE_GENERATION = 1;

/**
 * Judge a herdr `ping` result.
 *
 * bordr reads herdr's wire format directly, so a protocol change breaks it
 * SILENTLY — exactly how notifications died once when event names changed
 * spelling. Surfacing the mismatch is the difference between a five-second
 * diagnosis and an afternoon.
 */
export function judgeCompatibility(pong: {
	version?: unknown;
	protocol?: unknown;
	backend?: unknown;
	generation?: unknown;
}): Compatibility {
	const version = typeof pong.version === 'string' ? pong.version : null;
	if (pong.backend === 'core') {
		// Core's API "only grows" within a generation (herdr-core schema/README.md).
		const ok = pong.generation === CORE_GENERATION;
		return {
			level: ok ? 'ok' : 'incompatible',
			version,
			protocol: null,
			backend: 'core',
			message: ok
				? null
				: `herdr-core speaks API generation ${String(pong.generation ?? '?')}; bordr is built for ${CORE_GENERATION}. Check for a bordr update.`
		};
	}
	const protocol = typeof pong.protocol === 'number' ? pong.protocol : null;

	if (protocol === null) {
		return {
			level: 'incompatible',
			version,
			protocol,
			message: 'herdr did not report a protocol version — bordr cannot verify compatibility.'
		};
	}
	if (protocol < MIN_PROTOCOL) {
		return {
			level: 'incompatible',
			version,
			protocol,
			message: `herdr speaks protocol ${protocol}; bordr needs at least ${MIN_PROTOCOL}. Upgrade herdr.`
		};
	}
	if (protocol > MAX_TESTED_PROTOCOL) {
		return {
			level: 'untested',
			version,
			protocol,
			message: `herdr ${version ?? '?'} speaks protocol ${protocol}; bordr is tested to ${MAX_TESTED_PROTOCOL}. Things may break quietly — check for a bordr update.`
		};
	}
	return { level: 'ok', version, protocol, message: null, backend: 'tui' };
}
