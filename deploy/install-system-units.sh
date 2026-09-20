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
TARGET_USER="${SUDO_USER:-${USER:-$(id -un)}}"
if [ "${1:-}" = "--user" ]; then TARGET_USER="${2:?--user needs a name}"; fi
TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
UNIT_DIR="${SYSTEMD_SYSTEM_DIR:-/etc/systemd/system}"
SUDO=""
[ -w "$UNIT_DIR" ] || SUDO="sudo"

[ -n "$TARGET_HOME" ] || { echo "no home directory for $TARGET_USER" >&2; exit 1; }

for unit in herdr-session.service bordr.service; do
  sed -e "s|__HOME__|$TARGET_HOME|g" -e "s|__USER__|$TARGET_USER|g" "$HERE/system/$unit" \
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
