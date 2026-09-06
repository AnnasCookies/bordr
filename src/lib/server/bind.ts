/**
 * Refuse to serve on an address that would expose bordr to a network.
 *
 * bordr has no authentication by design: it drives coding agents that hold
 * full tool access on the host and browses its filesystem. The tailnet is the
 * whole security boundary, and until now "never bind 0.0.0.0" was a sentence
 * in the README rather than anything the code checked — one paste of
 * `HOST=0.0.0.0` and a stranger's machine is an open agent controller.
 */

/** Tailscale hands out addresses from the 100.64.0.0/10 CGNAT range. */
function isTailscale(host: string): boolean {
	const parts = host.split('.').map(Number);
	if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
		return false;
	}
	return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function isLoopback(host: string): boolean {
	if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
	const parts = host.split('.').map(Number);
	return parts.length === 4 && parts[0] === 127 && parts.every((n) => Number.isInteger(n));
}

export interface BindVerdict {
	ok: boolean;
	reason: string | null;
}

export const ALLOW_FLAG = 'BORDR_I_UNDERSTAND_THIS_HAS_NO_AUTH';

/**
 * `allowPublic` is deliberately an awkward, explicit opt-in rather than a
 * tidy `ALLOW_PUBLIC=1`: anyone typing it has been told exactly what they are
 * turning off, which is the point of the guard.
 */
export function judgeBind(host: string | undefined, allowPublic: string | undefined): BindVerdict {
	if (allowPublic === '1') return { ok: true, reason: null };
	const value = (host ?? '').trim();

	// An unset HOST is the most dangerous value of all: svelte-adapter-bun's
	// own default is 0.0.0.0, so "I forgot the line" is indistinguishable from
	// "expose me to everything". Refuse, and say which line to add.
	if (!value) {
		return {
			ok: false,
			reason:
				`HOST is not set, and svelte-adapter-bun then binds 0.0.0.0, every network ` +
				`interface. bordr has no authentication: anyone who can reach this port can ` +
				`drive your coding agents and read your files. Put HOST=127.0.0.1 in .env and ` +
				`front it with \`tailscale serve\`, or bind your 100.x tailnet address. ` +
				`If you genuinely mean to expose it, set ${ALLOW_FLAG}=1.`
		};
	}
	if (isLoopback(value) || isTailscale(value)) return { ok: true, reason: null };

	const what =
		value === '0.0.0.0' || value === '::'
			? `HOST=${value} binds every network interface`
			: `HOST=${value} is neither loopback nor a Tailscale address`;
	return {
		ok: false,
		reason:
			`${what}. bordr has no authentication: anyone who can reach this port can ` +
			`drive your coding agents and read your files. Bind 127.0.0.1 and put ` +
			`\`tailscale serve\` in front of it, or bind your 100.x tailnet address. ` +
			`If you genuinely mean to expose it, set ${ALLOW_FLAG}=1.`
	};
}

export interface HostPolicy {
	/** The HOST bordr was told to bind; requests naming it are fine. */
	bindHost: string | undefined;
	/** BORDR_ALLOWED_HOSTS: extra hostnames, comma separated, for a proxy on your own domain. */
	allowed: string | undefined;
	allowPublic: string | undefined;
}

/**
 * The request-side twin of `judgeBind`, against DNS rebinding.
 *
 * A hostile page can point its own hostname at 127.0.0.1 (or a tailnet IP)
 * after the browser has loaded it. From then on the browser sends requests to
 * bordr that are, by its own reckoning, same-origin: `Sec-Fetch-Site:
 * same-origin`, a matching `Origin`, and the attacker's name in `Host`. The
 * CSRF gate cannot tell them apart. What can is the Host header itself: bordr
 * knows every name it is willing to answer to, and 421 is the answer for the
 * rest. `tailscale serve` over HTTPS is immune (the certificate will not match
 * a rebound name); the plain-HTTP loopback trial and a direct 100.x bind are
 * not, and both are documented ways to run it.
 */
export function judgeHost(hostname: string, policy: HostPolicy): boolean {
	if (policy.allowPublic === '1') return true;
	const name = hostname.trim().toLowerCase();
	if (!name) return false;
	if (isLoopback(name) || isTailscale(name)) return true;
	if (name.endsWith('.ts.net')) return true;
	const bound = (policy.bindHost ?? '').trim().toLowerCase();
	if (bound && name === bound) return true;
	return (policy.allowed ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean)
		.includes(name);
}
