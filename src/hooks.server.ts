import { building, dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { Handle } from '@sveltejs/kit';
import { startPushWatcher } from '$lib/server/push';
import { ALLOW_FLAG, judgeBind, judgeHost, judgeUser, USERS_FLAG } from '$lib/server/bind';

/**
 * Checked once at startup. bordr refuses to SERVE rather than refusing to
 * start: exiting would restart-loop under `Restart=always` and bury the
 * explanation, whereas a 503 carrying the reason is the first thing the
 * operator sees when they load the page.
 *
 * Skipped under `vite dev`, which binds localhost itself and ignores HOST;
 * the guard is about the production adapter's default of 0.0.0.0.
 */
const bind = dev ? { ok: true, reason: null } : judgeBind(env.HOST, env[ALLOW_FLAG]);

const hostPolicy = {
	bindHost: env.HOST,
	allowed: env.BORDR_ALLOWED_HOSTS,
	allowPublic: env[ALLOW_FLAG]
};

/** Unset for a tailnet of one; see judgeUser for what setting it buys. */
const allowedUsers = env[USERS_FLAG];

// Start the blocked-agent push watcher with the server, not with the first
// visitor — notifications must fire while every phone is in a pocket.
if (!building) {
	if (!bind.ok) console.error(`bordr refused to serve — ${bind.reason}`);
	void startPushWatcher();

	// Guarantee the process actually exits on SIGTERM. A single lingering
	// handle otherwise leaves a live-but-deaf process that systemd reports
	// as active and Restart=always can never replace — the failure mode
	// that put bordr's phone client on 500s for eight hours.
	process.on('SIGTERM', () => {
		setTimeout(() => process.exit(0), 3_000).unref?.();
	});
}

// The app shell must always revalidate: an installed PWA has no refresh
// gesture, so a heuristically cached HTML page pins the phone to an old
// build indefinitely. no-cache + the ETag makes staleness impossible and
// revalidation cheap (304).
export const handle: Handle = async ({ event, resolve }) => {
	if (!bind.ok) {
		return new Response(`bordr refused to serve.\n\n${bind.reason}\n`, {
			status: 503,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	// DNS rebinding: see judgeHost. 421 Misdirected Request is the status
	// for "this server does not serve that name".
	if (!judgeHost(event.url.hostname, hostPolicy)) {
		return new Response(
			`bordr does not answer to the hostname "${event.url.hostname}".\n\n` +
				`It serves loopback, its own HOST, Tailscale addresses and *.ts.net names. ` +
				`For a proxy on your own domain, set BORDR_ALLOWED_HOSTS=that.domain in .env.\n`,
			{ status: 421, headers: { 'content-type': 'text/plain; charset=utf-8' } }
		);
	}

	// Identity, but only when the operator has asked for it. `tailscale serve`
	// sets this header and strips any copy the client sent, so it cannot be
	// forged from off the host; funnel carries none, so funnel traffic fails
	// here too. Unset means unchanged: the tailnet is the whole boundary.
	if (!judgeUser(event.request.headers.get('tailscale-user-login'), allowedUsers)) {
		return new Response(
			`bordr does not recognise you.\n\n` +
				`${USERS_FLAG} is set, so bordr answers only the tailnet logins it names, ` +
				`reached through \`tailscale serve\`. This request carried no Tailscale ` +
				`identity header, or one that is not on the list.\n`,
			{ status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } }
		);
	}

	// CSRF boundary for the agent-driving APIs, two headers deep:
	//
	// 1. Sec-Fetch-Site: anything not same-origin (e.g. a sandboxed artifact
	//    served by /raw, which runs as an opaque origin) must not reach
	//    state-changing routes.
	// 2. Origin: its host must be the host this request arrived at. Every
	//    browser sends Origin on a POST, including the pre-16.4 Safaris that
	//    have no Sec-Fetch-Site, and a sandboxed artifact sends the literal
	//    "null", which fails to parse and is refused. Compared by host, not
	//    scheme: SvelteKit's own check (disabled in vite.config.ts) compared
	//    full origins, and svelte-adapter-bun assumes https when nothing says
	//    otherwise, so on the plain-HTTP loopback trial every photo upload was
	//    refused as cross-site.
	//
	// Requests carrying neither header (curl, scripts on the box) pass; the
	// tailnet is their boundary, same as ttyd.
	//
	// Every non-GET, not just /api/: `/share` is a state-changing POST outside
	// that prefix, and a cross-site form could reach it — verified against a
	// running build, which accepted an `Origin: https://evil.example` post and
	// staged the attacker's text in the composer while the same post to /api/
	// was refused. A sandboxed /raw artifact reaches it too, because multipart
	// is CORS-safelisted and needs no preflight.
	if (event.request.method !== 'GET') {
		const site = event.request.headers.get('sec-fetch-site');
		if (site !== null && site !== 'same-origin' && site !== 'none') {
			return new Response('cross-origin writes are not allowed', { status: 403 });
		}
		const origin = event.request.headers.get('origin');
		if (origin !== null) {
			let originHost: string | null;
			try {
				originHost = new URL(origin).host;
			} catch {
				originHost = null;
			}
			if (originHost !== event.url.host) {
				return new Response('cross-origin writes are not allowed', { status: 403 });
			}
		}
	}

	const response = await resolve(event, {
		// Universal page loads read the detail endpoint's ETag so repeat transcript
		// polls can send If-None-Match. SvelteKit hides internal-fetch headers unless
		// they are explicitly safe to serialise into the hydration payload.
		filterSerializedResponseHeaders: (name) => name === 'etag'
	});

	// /raw serves agent-authored bytes and sets its own sandbox CSP; do not
	// overwrite it with the app shell's policy, and above all do not send
	// x-frame-options: DENY — the viewer frames these, and DENY renders as
	// the browser's broken-page face.
	//
	// This exemption used to name /f, which was the artifact route until byte
	// serving moved to /raw. /f is an ordinary app page now and SHOULD carry
	// the headers.
	const isArtifact = event.url.pathname.startsWith('/raw/');
	if (!isArtifact) {
		response.headers.set('x-content-type-options', 'nosniff');
		response.headers.set('referrer-policy', 'no-referrer');
		response.headers.set('x-frame-options', 'DENY');
	}

	if (response.headers.get('content-type')?.includes('text/html')) {
		response.headers.set('cache-control', 'no-cache');
	}
	// NB: the app-shell CSP is emitted by SvelteKit (see vite.config.ts), not
	// here — it must hash its own inline hydration script.
	return response;
};
