#!/usr/bin/env bash
# Render and install the system units for herdr-session + bordr.
#
# A user unit dies with the systemd user manager: on 2026-09-20 a stray SIGTERM
# to user@1000 ran exit.target and stopped herdr, bordr and every agent pane at
# once, and Linger does not resurrect a manager that has exited. On a server the
# herd belongs to the system manager. deploy/user/ keeps the user-unit variant.
#
# Usage: deploy/install-system-units.sh [--user <name>]   (needs sudo)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECKOUT="$(cd "$HERE/.." && pwd)"
TARGET_USER="${SUDO_USER:-${USER:-$(id -un)}}"
if [ "${1:-}" = "--user" ]; then TARGET_USER="${2:?--user needs a name}"; fi
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
TARGET_GROUP="$(id -gn "$TARGET_USER")"
UNIT_DIR="${SYSTEMD_SYSTEM_DIR:-/etc/systemd/system}"
SUDO=""
[ -w "$UNIT_DIR" ] || SUDO="sudo"

[ -n "$TARGET_HOME" ] || { echo "no home directory for $TARGET_USER" >&2; exit 1; }

# The binaries and checkout are wherever this install put them, not where the
# maintainer's did: PATH first (BUN_BIN/HERDR_BIN override), then the official
# installers' locations. The checkout is the one this script lives in.
BUN_BIN="${BUN_BIN:-$(command -v bun || echo "$TARGET_HOME/.bun/bin/bun")}"
HERDR_BIN="${HERDR_BIN:-$(command -v herdr || echo "$TARGET_HOME/.local/bin/herdr")}"
for bin in "$BUN_BIN" "$HERDR_BIN"; do
  [ -x "$bin" ] || echo "warning: $bin is not executable; set BUN_BIN/HERDR_BIN" >&2
done
[ -f "$CHECKOUT/.env" ] || echo "warning: $CHECKOUT/.env is missing; copy .env.example first" >&2

for unit in herdr-session.service bordr.service; do
  sed -e "s|__CHECKOUT__|$CHECKOUT|g" -e "s|__BUN__|$BUN_BIN|g" \
    -e "s|__HERDR__|$HERDR_BIN|g" -e "s|__HOME__|$TARGET_HOME|g" \
    -e "s|__GROUP__|$TARGET_GROUP|g" -e "s|__USER__|$TARGET_USER|g" "$HERE/system/$unit" \
    | $SUDO install -m 0644 /dev/stdin "$UNIT_DIR/$unit"
  echo "installed $UNIT_DIR/$unit"
done

$SUDO systemctl daemon-reload
echo
echo "next:"
echo "  bun run build && bun scripts/publish-build.ts   # the copy the unit runs"
echo "  sudo systemctl enable --now herdr-session bordr"
echo
echo "Already running them as user units? Disable those first, or two servers"
echo "will fight over the same herdr socket and port:"
echo "  systemctl --user disable --now herdr-session bordr"
