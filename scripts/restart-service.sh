#!/usr/bin/env bash
# Restart the bordr service wherever it is installed, then prove the restart
# took. The unit moved from the systemd user manager to the system manager
# (see deploy/system/), and both layouts are supported, so `bun run deploy`
# must not hard-code either one.
set -euo pipefail
SERVICE="${BORDR_SERVICE:-bordr}"

# System first. A user unit left behind by the move is still found by
# `systemctl --user cat`, and checking it first once restarted that leftover
# instead: it crash-looped on EADDRINUSE while the real service kept serving
# the old build, and the smoke test passed against the old process. Every
# deploy after the move (#48) changed nothing that way, through #56.
if systemctl --system cat "$SERVICE" >/dev/null 2>&1; then
  manager=--system
  if systemctl --user cat "$SERVICE" >/dev/null 2>&1; then
    echo "warning: a user unit named $SERVICE also exists; restarting the system one." >&2
    echo "  Retire the user unit (systemctl --user disable $SERVICE, then remove its file)." >&2
  fi
elif systemctl --user cat "$SERVICE" >/dev/null 2>&1; then
  manager=--user
else
  echo "no $SERVICE unit found in either manager; skipping restart" >&2
  exit 0
fi

show() { systemctl "$manager" show "$SERVICE" -p "$1" --value; }

before=$(show InvocationID)

if [ "$manager" = --user ] || [ "$(id -u)" = "0" ]; then
  systemctl "$manager" restart "$SERVICE"
# The polkit rule from deploy/install-system-units.sh allows this without a
# password; sudo is only the fallback when that rule is not installed.
elif ! systemctl restart --no-ask-password "$SERVICE" 2>/dev/null; then
  sudo systemctl restart "$SERVICE"
fi

# A new InvocationID means systemd really started a new process. Checking it
# again after a pause catches a process that started and then died: with
# Restart=always a crash loop keeps minting new IDs and is rarely 'active'.
after=$(show InvocationID)
sleep 2
settled=$(show InvocationID)
state=$(show ActiveState)
if [ -z "$after" ] || [ "$after" = "$before" ]; then
  echo "restart of $SERVICE ($manager) did not start a new process" >&2
  exit 1
fi
if [ "$state" != active ] || [ "$settled" != "$after" ]; then
  echo "$SERVICE ($manager) restarted but is not staying up (state: $state)." >&2
  echo "  journalctl $([ "$manager" = --user ] && echo --user) -u $SERVICE -n 30" >&2
  exit 1
fi
echo "restarted $SERVICE ($manager), invocation ${after:0:12}"
