#!/usr/bin/env bash
# Restart the bordr service wherever it is installed. The unit moved from the
# systemd user manager to the system manager (see deploy/system/), and both
# layouts are supported, so `bun run deploy` must not hard-code either one.
set -euo pipefail
SERVICE="${BORDR_SERVICE:-bordr}"

if systemctl --user cat "$SERVICE" >/dev/null 2>&1; then
  exec systemctl --user restart "$SERVICE"
fi
if systemctl cat "$SERVICE" >/dev/null 2>&1; then
  if [ "$(id -u)" = "0" ]; then exec systemctl restart "$SERVICE"; fi
  exec sudo systemctl restart "$SERVICE"
fi
echo "no $SERVICE unit found in either manager; skipping restart" >&2
