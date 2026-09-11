# Contributing

All contributions welcome — features, fixes, docs, harness adapters, a better
word for something. You do not need to open an issue first. Open a pull
request and we will work it out in review.

Small and rough beats polished and never sent. If you are not sure whether
something fits, send it anyway and say you are not sure.

## The one hard rule

**Do not weaken the security model.**

bordr has no authentication. That is deliberate, and everything about how it
is deployed follows from it: loopback only, behind `tailscale serve`, on a
tailnet you control. [SECURITY.md](SECURITY.md) is the whole argument and is
worth reading before you change anything under `src/lib/server/` or
`src/hooks.server.ts`.

These are load-bearing. A pull request that removes or loosens one needs to
say why in the description, and will get asked about:

- **The bind guard** (`src/lib/server/bind.ts`) refuses to serve on anything
  that is not loopback or a Tailscale address.
- **The hostname check** answers `421` to any `Host` bordr was not told to
  serve. It is what closes DNS rebinding.
- **The CSRF boundary** (`src/hooks.server.ts`) rejects cross-origin
  state-changing requests. It covers every non-GET route, not just `/api/`.
- **File-root confinement** (`src/lib/server/files.ts`) checks paths lexically
  _and_ after `realpath`, and refuses dotfiles at the resolver.
- **The keypad allowlist** (`src/routes/api/agents/[pane]/keys/validate.ts`)
  accepts only inert keys. Text goes through the prompt or type endpoints.
- **Output escaping.** Terminal bytes are HTML-escaped and the ANSI renderer
  emits only colour spans. Agent markdown goes through DOMPurify with an
  explicit allow-list. Agent output is untrusted input, always.

If you think one of these is wrong, that is a conversation worth having — open
an issue and make the argument. Just do not quietly change it.

## Running it

You need [Bun](https://bun.com), and a running [herdr](https://herdr.dev) for
anything beyond the shell to appear.

```sh
bun install
bun run dev
```

Copy `.env.example` to `.env` first. It documents every variable bordr reads.

## Before you open a pull request

```sh
bun run lint        # prettier --check, then eslint
bun run check       # svelte-check
bun run test:unit --run
```

CI runs exactly these plus a build, on every pull request, so running them
locally just saves you a round trip.

The browser tests are a separate matter:

```sh
bun run test:e2e -- --workers=1
```

They drive a **real herdr with real agent panes**, so they cannot run in CI
and they will skip themselves if nothing is running. Use `--workers=1`: the
suite shares one live herdr and goes red at random under parallel load.

## House style

- **British English** in prose, comments and anything you name. Never respell
  a third-party API: `color` and `gray-500` stay as they are.
- **Comments explain why, not what.** The codebase is full of comments naming
  the bug that made a line necessary. That is the standard, and it is the most
  useful thing you can leave behind.
- **Never swallow an error.** Every API call and filesystem operation handles
  failure. An empty `catch` needs a comment saying what is being ignored and
  why it is safe.
- **Small pure functions, tested directly.** Parsing, grouping, splitting and
  path resolution all live in plain modules with their own tests. Put logic
  there rather than in a component where nothing can reach it.
- **Phone first.** bordr is used one-handed on a 390px screen. Horizontal
  overflow is a bug and there are tests asserting its absence. Tap targets
  want 44px.

## Adding a harness

This is the most useful thing you can contribute, and the most self-contained.

Adapters live in `src/lib/server/transcript/`, one file per harness, each
turning that harness's own session format into bordr's message shape. Read
`codex.ts` for a short one and `claude.ts` for a thorough one, then register
yours in `index.ts`. Every adapter has a test with a real captured session as
a fixture; please include one, with anything identifying stripped out.

A harness with no adapter still works — it falls back to a cleaned terminal
snapshot — so an adapter is an upgrade, not a prerequisite.

## Reporting a bug

Say what you did, what happened, and what you expected. Include the harness
and the phone browser, since most of the sharp edges are specific to one or
the other.

For anything with security implications, see the reporting section in
[SECURITY.md](SECURITY.md) rather than opening a public issue.
