<script lang="ts" module>
	export type Connection =
		'live' | 'reconnecting' | 'silent' | 'stale' | 'bordr' | 'herdr' | 'incompatible';

	/**
	 * The copy is unchanged from the footer note it replaces. `reconnecting`
	 * returns nothing on purpose: a stream that drops and recovers is the
	 * ordinary case, and a banner for it reads as a fault.
	 */
	export function connectionText(connection: Connection): string | null {
		if (connection === 'bordr') return 'bordr unreachable — reconnecting…';
		if (connection === 'silent')
			return 'No events from bordr yet. If you are behind a reverse proxy, disable buffering for /api/events.';
		if (connection === 'herdr') return 'herdr is not running — state is last known';
		if (connection === 'incompatible') return 'herdr version not supported';
		if (connection === 'stale') return 'no update in a while — state may be stale';
		return null;
	}
</script>

<script lang="ts">
	let {
		connection,
		compat
	}: {
		connection: Connection;
		compat: { level: string; message: string | null } | null;
	} = $props();

	// Only `incompatible` is red; everything else is a recoverable amber.
	const danger = $derived(connection === 'incompatible' || compat?.level === 'incompatible');
	/**
	 * When the fault is herdr's, the server's own sentence wins: "protocol 18;
	 * bordr needs 19" is actionable where "version not supported" is not. When
	 * bordr itself is down, `compat` is stale and would blame the wrong thing.
	 */
	const text = $derived.by(() => {
		const herdrFault = connection === 'herdr' || connection === 'incompatible';
		if (herdrFault && compat?.message) return compat.message;
		return (
			connectionText(connection) ??
			(compat && compat.level !== 'ok' && compat.message ? compat.message : null)
		);
	});
</script>

{#if text}
	<p
		role="status"
		class="mx-4 mb-2 flex items-center gap-2 rounded-[10px] border px-3 py-2.5 text-[12.5px] {danger
			? 'border-red-200 bg-danger-bg text-danger-ink dark:border-red-900/50'
			: 'border-blocked-edge bg-blocked-bg text-blocked-ink'}"
	>
		<span
			class="h-2 w-2 shrink-0 rounded-full {danger ? 'bg-danger' : 'bg-blocked'}"
			aria-hidden="true"
		></span>
		{text}
	</p>
{/if}
