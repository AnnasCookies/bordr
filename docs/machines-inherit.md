# Why bordr inherits herdr's machines again

Notes for the pull request. This change loosens a security default that was
added deliberately, so the argument belongs somewhere a reviewer can read it
without having to reconstruct it.

## What changed

`BORDR_MACHINES` used to be the switch that turned remote machines on. Empty
meant none, so a fresh install reached only its own host.

It now **narrows** instead. Empty means bordr inherits herdr's own endpoint
list — but only while bordr is bound to loopback or a tailnet address with
`BORDR_I_UNDERSTAND_THIS_HAS_NO_AUTH` unset. Set the flag and the explicit
list is required again, exactly as before.

## The argument

The opt-in existed because bordr has no authentication, and inheriting
herdr's endpoints would make "every host you have ever typed into a terminal"
drivable by anyone who reaches bordr.

That reasoning holds when those two sets of people differ. Under the bind
bordr actually requires, they do not:

- **Loopback.** SECURITY.md already makes this argument itself, about the
  identity header: _"Someone who can reach loopback directly to forge one is
  already on the machine, and already owns every agent on it."_ The same is
  true of the machine list. Someone at that loopback port can already run
  `herdr --remote` from a shell.
- **Tailnet.** SECURITY.md: _"The tailnet is the authentication. If a device
  is on your tailnet it is trusted completely."_ A device that is trusted
  completely is not made more dangerous by a machine list.

`judgeBind` already refuses to serve on anything else, so those are the only
two states a running bordr can be in without the flag. In both, naming a
machine in herdr and making it reachable from bordr grant the same access to
the same people. The second list is bookkeeping that duplicates the first.

The cost of asking for it anyway is not zero. It is a sidebar that silently
stops listing the machines you use every day, with the reason in a file the
app never mentions — which is how this was found: the machines vanished after
a rebase onto the version that introduced the gate, and nothing said why.

## Where it still applies

`BORDR_I_UNDERSTAND_THIS_HAS_NO_AUTH=1` means somebody deliberately bound
bordr somewhere that is neither loopback nor a tailnet. "Everyone who can
reach this port" is then genuinely wider than "whoever is sitting at this
terminal", and the explicit list is required again.

## The case this cannot see

`tailscale funnel` fronts a loopback bind exactly as `serve` does, so the bind
alone cannot tell them apart. Funnel sends no identity header, which is what
`BORDR_ALLOWED_USERS` refuses — that list shuts a funnel out, machines
included. Documented in SECURITY.md rather than guessed at in code.

## Why this is not a UI setting

It was considered. It cannot be: a toggle in Settings would let anyone who
reaches bordr grant bordr more reach, putting the control inside the thing it
protects. It stays server-side configuration.

## Tests

`machinesInherit` in `src/lib/server/bind.test.ts` pins every branch —
loopback, tailnet, the flag, unset HOST, a private LAN address, and 100.x
outside the CGNAT range (which is somebody's public address, not a tailnet).
