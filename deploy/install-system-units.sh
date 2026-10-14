#!/usr/bin/env bash
# Render and install the system units for herdr-session + bordr.
#
# A user unit dies with the systemd user manager: on 2026-09-20 a stray SIGTERM
# to user@1000 ran exit.target and stopped herdr, bordr and every agent pane at
# once, and Linger does not resurrect a manager that has exited. On a server the
# herd belongs to the system manager. deploy/user/ keeps the user-unit variant.
#
# Usage: deploy/install-system-units.sh [--user <name>] [--session <name>]
#        [--instance <name>] [--bordr-only]   (needs sudo)
#
# --session is the herdr session to run (default: main). Use `default` for
# herdr's default session — the one plain `herdr` attaches to.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECKOUT="$(cd "$HERE/.." && pwd)"
TARGET_USER="${SUDO_USER:-${USER:-$(id -un)}}"
SESSION="main"
INSTANCE=""
BORDR_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --user) TARGET_USER="${2:?--user needs a name}"; shift 2 ;;
    --session) SESSION="${2:?--session needs a name}"; shift 2 ;;
    --instance) INSTANCE="${2:?--instance needs a name}"; BORDR_ONLY=1; shift 2 ;;
    --bordr-only) BORDR_ONLY=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$SESSION" in *[!A-Za-z0-9._-]*|"") echo "bad session name: $SESSION" >&2; exit 2 ;; esac
case "$INSTANCE" in *[!A-Za-z0-9_-]*) echo "bad instance name" >&2; exit 2 ;; esac
NAME="bordr${INSTANCE:+-$INSTANCE}"
ENV_FILE="$CHECKOUT/.env${INSTANCE:+.$INSTANCE}"
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
[ -f "$ENV_FILE" ] || echo "warning: instance environment file is missing; copy .env.example first" >&2
HERDR_SOCKET="$TARGET_HOME/.config/herdr/sessions/$SESSION/herdr.sock"
[ "$SESSION" != default ] || HERDR_SOCKET="$TARGET_HOME/.config/herdr/herdr.sock"

units=(bordr.service)
[ "$BORDR_ONLY" = 1 ] || units=(herdr-session.service bordr.service)
for unit in "${units[@]}"; do
  destination="$unit"
  [ "$unit" != bordr.service ] || destination="$NAME.service"
  sed -e "s|__CHECKOUT__|$CHECKOUT|g" -e "s|__BUN__|$BUN_BIN|g" \
    -e "s|__HERDR__|$HERDR_BIN|g" -e "s|__HOME__|$TARGET_HOME|g" \
    -e "s|__GROUP__|$TARGET_GROUP|g" -e "s|__USER__|$TARGET_USER|g" \
    -e "s|__SESSION__|$SESSION|g" -e "s|__NAME__|$NAME|g" \
    -e "s|__ENV_FILE__|$ENV_FILE|g" -e "s|__HERDR_SOCKET__|$HERDR_SOCKET|g" "$HERE/system/$unit" \
    | $SUDO install -m 0644 /dev/stdin "$UNIT_DIR/$destination"
  echo "installed $UNIT_DIR/$destination"
done

# Without this, Settings → System cannot start or stop herdr and `bun run
# deploy` cannot restart bordr: both run as $TARGET_USER, with no terminal to
# answer a sudo prompt. The rule covers these two units and three verbs only.
POLKIT_DIR="${POLKIT_RULES_DIR:-/etc/polkit-1/rules.d}"
ROOT=""
[ "$(id -u)" = "0" ] || ROOT="sudo"
if [ -d "$(dirname "$POLKIT_DIR")" ]; then
  sed -e "s|__USER__|$TARGET_USER|g" -e "s|__NAME__|$NAME|g" "$HERE/system/bordr-polkit.rules" \
    | $ROOT install -D -m 0644 /dev/stdin "$POLKIT_DIR/50-$NAME.rules"
  echo "installed $POLKIT_DIR/50-$NAME.rules"
else
  echo "warning: no polkit; start/stop from bordr will need sudo" >&2
fi

$SUDO systemctl daemon-reload
echo
echo "next:"
echo "  BORDR_LIVE_DIR=$TARGET_HOME/.local/lib/$NAME bun scripts/publish-build.ts"
[ "$BORDR_ONLY" = 1 ] || echo "  sudo systemctl enable --now herdr-session"
echo "  sudo systemctl enable --now $NAME"
echo "  sudo tailscale serve --bg --https=<your-port> unix:/run/$NAME/bordr.sock"
echo "  Set BORDR_URL in the instance environment file to the printed HTTPS URL."
echo
echo "Already running them as user units? Disable those first, or two servers"
echo "will fight over the same herdr session:"
echo "  systemctl --user disable --now herdr-session@$SESSION bordr"
