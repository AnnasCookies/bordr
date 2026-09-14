import { getClient } from '$lib/server/herdr';
import { activeOmpTranscript, type PaneProcessInfo } from './omp-active';
import type { Adapter } from './types';

interface ProcessInfoResult {
	process_info?: PaneProcessInfo;
}

/** Prefer the transcript open in the pane's root OMP process over a stale report. */
export async function resolveLocalTranscript(
	adapter: Adapter,
	paneId: string,
	agentKind: string,
	reportedSession: string
): Promise<string | null> {
	if (agentKind === 'omp') {
		try {
			const result = await getClient().request<ProcessInfoResult>('pane.process_info', {
				pane_id: paneId
			});
			const active = activeOmpTranscript(result.process_info);
			if (active) return active;
		} catch {
			// Non-Linux hosts, old Herdr builds and process races use the report.
		}
	}
	return adapter.resolve(reportedSession);
}
