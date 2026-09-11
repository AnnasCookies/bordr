# Security

Read this before installing. It is short, and the first section is the whole
point.

## What bordr is

bordr is a remote control for coding agents. Through it you can type a prompt
into any agent on the host, press keys into its terminal, answer its permission
prompts, start new agents in any directory under `$HOME`, upload images, and
browse and download files under the roots you configure.

The agents themselves can run arbitrary commands. So:

> **Anyone who can reach bordr's port can run arbitrary code on the host and
> read files from it, and on every machine you have named in
> `BORDR_MACHINES`. There is no login.**

That is not a bug being tracked. It is the design, and everything below follows
from it.

## The intended deployment

One machine, one user, on a private network you control. In practice a
[Tailscale](https://tailscale.com) tailnet:

```
your phone ──tailnet──> tailscale serve ──127.0.0.1──> bordr ──unix socket──> herdr (this host)
                                                          └──ssh -L────────> herdr (each named machine)
```

- bordr binds **loopback only**.
- `tailscale serve` terminates TLS and is reachable only by devices on your
  tailnet.
- Nothing is published to the internet, and no port is forwarded.

The tailnet is the authentication. If a device is on your tailnet it is trusted
completely; if it is not, it cannot reach bordr at all.

### The bind guard

Because "bind loopback" used to be advice rather than a rule, bordr now checks.
It refuses to serve on anything that is not loopback or a Tailscale address
(`100.64.0.0/10`), and when `HOST` is unset at all (the adapter's own default is
every interface), returning `503` with an explanation, unless you set:

```
BORDR_I_UNDERSTAND_THIS_HAS_NO_AUTH=1
```

The flag is deliberately unwieldy. If you are typing it, you should be able to
say out loud what you are switching off.

**Do not put bordr behind a plain reverse proxy on the open internet.** A proxy
gives you TLS, not authentication. If you need that, put a real authenticating
proxy in front of it and treat the result as load-bearing security you own.

### Machines

bordr can drive herdr on other machines over SSH. It does **not** inherit
herdr's own endpoint list: a machine is reachable only once you name it here,
by its herdr id or label.

```
BORDR_MACHINES=laptop,tower
```

Empty, the default, means this host only. Every machine you name is drivable
by anyone who reaches bordr, so the list is the blast radius. Authentication
is your own SSH config and agent; bordr reads no keys and writes none.

### The hostname check

bordr answers only to hostnames it expects: loopback, its own `HOST`, Tailscale
addresses and `*.ts.net` names, plus anything in `BORDR_ALLOWED_HOSTS`. Any
other `Host` header gets `421`. This closes DNS rebinding, where a page you
visit points its own domain at your machine and then talks to bordr as if it
were same-origin; it matters on the plain-HTTP loopback trial and a direct
tailnet bind, since HTTPS through `tailscale serve` already refuses a rebound
name at the certificate.

## What bordr does defend against

These are implemented and tested, and they matter even inside a trusted
network, mostly because an _agent_ can be induced to write a hostile file.

| Boundary                     | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File-browser confinement** | Serves only under configured roots, checked lexically **and** after `realpath`, so a symlink pointing out of the estate is refused                                                                                                                                                                                                                                                                                                                            |
| **Dotfiles**                 | Refused at the resolver, not merely hidden from listings, and again on the resolved path, so `.env` and `.ssh` cannot be fetched by direct URL or through a symlink                                                                                                                                                                                                                                                                                           |
| **Artifact sandboxing**      | Agent-authored HTML and SVG render with `Content-Security-Policy: sandbox allow-scripts`, an opaque origin, so their scripts run but cannot call bordr's API                                                                                                                                                                                                                                                                                                  |
| **CSRF**                     | Every state-changing request is rejected when `Sec-Fetch-Site` says anything but same-origin, or when the `Origin` host is not the host the request arrived at; either stops a sandboxed artifact driving your agents. This covers every route, not only `/api/`: the Android share target at `/share` is a POST outside that prefix and is guarded the same way. Requests with neither header (curl, scripts on the box) pass; the tailnet is their boundary |
| **Hostname**                 | Any `Host` bordr was not told to serve gets `421`, against DNS rebinding (above)                                                                                                                                                                                                                                                                                                                                                                              |
| **Keypad allowlist**         | The on-screen keys accept only inert navigation keys — arrows, enter, esc, tab, shift+tab, space and backspace. No control sequences and no text injection. Text goes through the prompt endpoint, or in terminal mode the type endpoint, which caps a send and refuses control characters                                                                                                                                                                    |
| **Host keys**                | SSH runs with `BatchMode=yes` against your own `known_hosts`; an unknown or changed key fails the connection instead of prompting. Host key checking is never disabled                                                                                                                                                                                                                                                                                        |
| **Transcript escaping**      | Terminal output is HTML-escaped before rendering; the ANSI renderer emits only colour spans                                                                                                                                                                                                                                                                                                                                                                   |
| **Markdown**                 | The file viewer renders with `marked`, then sanitises with DOMPurify with `style`, `form` and `iframe` forbidden                                                                                                                                                                                                                                                                                                                                              |
| **Transcript markdown**      | Agent messages render in bordr's own origin through a stricter allow-list: tags and attributes named explicitly, `javascript:` and `data:` URLs refused, and `class` kept only as `language-*` on a code element so agent output cannot borrow bordr's own layout utilities to paint over the app                                                                                                                                                             |
| **Upload limits**            | Images are type-checked and size-capped, at most six per message                                                                                                                                                                                                                                                                                                                                                                                              |
| **Frame protection**         | Every app response sends `x-frame-options: DENY` and `frame-ancestors 'none'`; only the raw artifact route is exempt, because the viewer frames it                                                                                                                                                                                                                                                                                                            |

## What it does not defend against

Stated plainly, because a security document that only lists wins is not useful.

- **Anyone on your tailnet.** There are no per-device permissions and no audit
  log. Every tailnet device is fully trusted.
- **A compromised host.** bordr is a window onto local agents. If the host is
  compromised, bordr is the least of it.
- **A hostile agent.** bordr renders what your agents produce and drives them on
  your behalf. It sandboxes their artifacts and escapes their output, but it
  does not judge their intent.
- **Denial of service.** No rate limiting. On a private network that is a
  deliberate omission, not an oversight.
- **Secrets in transcripts.** If an agent prints a key to its terminal, bordr
  will show it. It reads transcripts; it does not redact them.
- **Skill descriptions.** The composer's `/` list reads the front matter of
  your skills, commands and plugins (the same files the harness reads) and
  sends names and descriptions to the phone. Keep secrets out of those files.
- **Multi-user anything.** One host, one human. There are no accounts.

## Reporting a vulnerability

Open a GitHub issue for anything that is already public knowledge. For anything
that is not, use GitHub's **private vulnerability reporting** on this
repository rather than an issue.

Useful reports say what an attacker can reach that they should not. For
example a path that escapes the file roots, a way for a sandboxed artifact to
reach `/api`, or a way to get text into an agent through the keypad endpoint.

"bordr has no authentication" is documented above and is not a vulnerability.
