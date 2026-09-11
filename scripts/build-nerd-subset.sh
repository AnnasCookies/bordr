#!/usr/bin/env bash
# Rebuild the Nerd Font symbol subsets in static/fonts/.
#
# THREE faces, not one, each with its own unicode-range in layout.css. The
# browser downloads a face only when the page actually contains a codepoint in
# its range, so full coverage costs nothing for the ranges nobody uses:
#
#   core   box drawing, blocks, braille, arrows, Powerline   ~13KB   almost always
#   icons  Seti, Devicons, Codicons, Font Awesome, Weather,  ~570KB  prompt icons
#          Font Logos, Powerline Extra, Pomicons
#   mdi    Material Design Icons                             ~430KB  starship, etc
#
# Subsetting to the glyphs one machine happens to use would be smaller still,
# but every user runs a different prompt — this way anyone's status line
# renders, and only the person whose prompt uses Material pays for Material.
set -euo pipefail

SRC=${1:-/usr/share/fonts/TTF/CaskaydiaMonoNerdFontMono-Regular.ttf}
OUT=${2:-static/fonts}

CORE='U+2190-2BFF,U+2500-259F,U+25A0-25FF,U+2800-28FF,U+E0A0-E0D7'
ICONS='U+E000-E00A,U+E200-E2A9,U+E300-E3E3,U+E5FA-E6B7,U+E700-E8EF,U+EA60-EC1E,U+ED00-EFCE,U+F000-F2FF,U+F300-F381,U+F400-F533'
MDI='U+F0001-F1AF0'

[ -f "$SRC" ] || { echo "Source font not found: $SRC" >&2; exit 1; }
mkdir -p "$OUT"

build() {
  uvx --with brotli --from fonttools pyftsubset "$SRC" \
    --unicodes="$2" --layout-features='' --no-hinting --desubroutinize \
    --flavor=woff2 --output-file="$OUT/nerd-$1.woff2"
  printf '  nerd-%-6s %5s KB\n' "$1" "$(( $(stat -c%s "$OUT/nerd-$1.woff2") / 1024 ))"
}

build core "$CORE"
build icons "$ICONS"
build mdi "$MDI"
