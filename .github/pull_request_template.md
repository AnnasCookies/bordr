<!--
Thanks for sending this. No issue needed first; if it is rough, say so and
send it anyway.
-->

## What this changes

## Why

<!--
Only if your change touches src/lib/server/, src/hooks.server.ts, or anything
that renders agent output. Delete this section otherwise.
-->

## Security

bordr has no authentication, so these are load-bearing. Tick what applies, or
say which one you changed and why:

- [ ] Does not affect the bind guard, the hostname check or the CSRF boundary
- [ ] Does not widen the keypad allowlist or the type endpoint
- [ ] Does not loosen file-root confinement or the dotfile refusal
- [ ] Does not put unescaped agent output into the DOM

## Checks

- [ ] `bun run lint`
- [ ] `bun run check`
- [ ] `bun run test:unit --run`
