#!/usr/bin/env bash
# Rebuild static/fonts/nerd-symbols.woff2.
#
# Why a subset: the full CaskaydiaMono Nerd Font Mono is 2.9MB, and the
# Material Design range alone is ~7,000 glyphs (1MB on its own as woff2). A
# phone should not download that to draw a spinner.
#
# The ranges below were chosen from evidence, not taste: across every live
# pane on this machine, 13,261 of 13,403 non-ASCII symbol uses were box
# drawing, blocks, braille and arrows. Codicons, Devicons and Seti had zero
# uses and are excluded; Material is limited to the few a harness status line
# actually draws. Widen it if something shows as tofu.
set -euo pipefail

SRC=${1:-/usr/share/fonts/TTF/CaskaydiaMonoNerdFontMono-Regular.ttf}
OUT=${2:-static/fonts/nerd-symbols.woff2}

RANGES='U+2190-2BFF,U+2500-259F,U+25A0-25FF,U+2800-28FF,U+E0A0-E0D7,U+E300-E3E3,U+F000-F2FF,U+F300-F381,U+F400-F533,U+F01BC,U+F0443,U+F04C5,U+F06A9'

[ -f "$SRC" ] || { echo "Source font not found: $SRC" >&2; exit 1; }
mkdir -p "$(dirname "$OUT")"

uvx --with brotli --from fonttools pyftsubset "$SRC" \
  --unicodes="$RANGES" \
  --layout-features='' --no-hinting --desubroutinize \
  --flavor=woff2 --output-file="$OUT"

printf '%s: %s KB\n' "$OUT" "$(( $(stat -c%s "$OUT") / 1024 ))"
