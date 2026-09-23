#!/usr/bin/env bash
# Render and install the system units for herdr-session + bordr.
#
# A user unit dies with the systemd user manager: on 2026-09-20 a stray SIGTERM
# to user@1000 ran exit.target and stopped herdr, bordr and every agent pane at
# once, and Linger does not resurrect a manager that has exited. On a server the
# herd belongs to the system manager. deploy/user/ keeps the user-unit variant.
#
# Usage: deploy/install-system-units.sh [--user <name>] [--session <name>]   (needs sudo)
#
# --session is the herdr session to run (default: main). Use `default` for
# herdr's default session — the one plain `herdr` attaches to.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECKOUT="$(cd "$HERE/.." && pwd)"
TARGET_USER="${SUDO_USER:-${USER:-$(id -un)}}"
SESSION="main"
while [ $# -gt 0 ]; do
  case "$1" in
    --user) TARGET_USER="${2:?--user needs a name}"; shift 2 ;;
    --session) SESSION="${2:?--session needs a name}"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$SESSION" in *[!A-Za-z0-9._-]*|"") echo "bad session name: $SESSION" >&2; exit 2 ;; esac
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
    -e "s|__GROUP__|$TARGET_GROUP|g" -e "s|__USER__|$TARGET_USER|g" \
    -e "s|__SESSION__|$SESSION|g" "$HERE/system/$unit" \
    | $SUDO install -m 0644 /dev/stdin "$UNIT_DIR/$unit"
  echo "installed $UNIT_DIR/$unit"
done

# Without this, Settings → System cannot start or stop herdr and `bun run
# deploy` cannot restart bordr: both run as $TARGET_USER, with no terminal to
# answer a sudo prompt. The rule covers these two units and three verbs only.
POLKIT_DIR="${POLKIT_RULES_DIR:-/etc/polkit-1/rules.d}"
ROOT=""
[ "$(id -u)" = "0" ] || ROOT="sudo"
if [ -d "$(dirname "$POLKIT_DIR")" ]; then
  sed -e "s|__USER__|$TARGET_USER|g" "$HERE/system/bordr-polkit.rules" \
    | $ROOT install -D -m 0644 /dev/stdin "$POLKIT_DIR/50-bordr.rules"
  echo "installed $POLKIT_DIR/50-bordr.rules"
else
  echo "warning: no polkit; start/stop from bordr will need sudo" >&2
fi

$SUDO systemctl daemon-reload
echo
echo "next:"
echo "  bun run build && bun scripts/publish-build.ts   # the copy the unit runs"
echo "  sudo systemctl enable --now herdr-session bordr"
echo
echo "Already running them as user units? Disable those first, or two servers"
echo "will fight over the same herdr socket and port:"
echo "  systemctl --user disable --now herdr-session@$SESSION bordr"
