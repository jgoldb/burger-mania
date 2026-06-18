#!/usr/bin/env bash
# Convert a tree of Elasto Mania level packs into Burger Mania maps, mirroring
# the directory structure. Each level pack is a .zip of .lev files; this script
# extracts every zip and runs tools/lev2bmm.js over its contents.
#
#   tools/empack2bmm.sh [LEV_ROOT] [BMM_OUT] [-- lev2bmm options...]
#
#   LEV_ROOT  dir holding pack folders, each with one or more .zip of .lev files
#             (default: levels/test/lev)
#   BMM_OUT   dir to mirror the .bmm output into  (default: levels/test/bmm)
#   anything after `--` is forwarded verbatim to lev2bmm.js (e.g. --theme desert)
#
# A zip at  <LEV_ROOT>/<pack>/<name>.zip  produces  <BMM_OUT>/<pack>/<name>/*.bmm
#
# CASE-INSENSITIVITY (the whole reason this is a committed script): Elma packs
# mix `.lev` and `.LEV` extensions freely. unzip's wildcard match is
# case-SENSITIVE by default, so a bare `unzip '*.lev'` silently drops every
# uppercase `.LEV`. The `-C` flag below makes the match case-insensitive so all
# of them come through. (lev2bmm.js's own directory scan is already
# case-insensitive via /\.lev$/i, so once extracted, case no longer matters.)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LEV_ROOT="${1:-$ROOT_DIR/levels/test/lev}"
BMM_OUT="${2:-$ROOT_DIR/levels/test/bmm}"

# Collect any pass-through options after `--`.
EXTRA=()
seen_sep=0
for a in "$@"; do
  if [ "$seen_sep" = 1 ]; then EXTRA+=("$a"); fi
  if [ "$a" = "--" ]; then seen_sep=1; fi
done

command -v unzip >/dev/null || { echo "error: unzip not found on PATH" >&2; exit 1; }
command -v node  >/dev/null || { echo "error: node not found on PATH"  >&2; exit 1; }
[ -d "$LEV_ROOT" ] || { echo "error: LEV_ROOT not a directory: $LEV_ROOT" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

shopt -s nullglob
total_zip=0 total_bmm=0 zips=0
for z in "$LEV_ROOT"/*/*.zip; do
  zips=$((zips + 1))
  pack="$(basename "$(dirname "$z")")"
  name="$(basename "$z" .zip)"
  exdir="$TMP/$pack/$name"
  outdir="$BMM_OUT/$pack/$name"
  mkdir -p "$exdir" "$outdir"

  # -C case-insensitive match, -j junk paths (flatten), -o overwrite, -q quiet
  unzip -o -j -q -C "$z" '*.lev' -d "$exdir"

  zlev=$(unzip -l "$z" | grep -ciE '\.lev$' || true)   # reliable: matches end of line
  node "$ROOT_DIR/tools/lev2bmm.js" "$exdir" --outdir "$outdir" "${EXTRA[@]}" || true
  bmm=$(find "$outdir" -maxdepth 1 -iname '*.bmm' | wc -l)

  printf '%-28s lev=%-4s bmm=%-4s\n' "$pack/$name" "$zlev" "$bmm"
  total_zip=$((total_zip + zlev))
  total_bmm=$((total_bmm + bmm))
done

if [ "$zips" = 0 ]; then
  echo "note: no <pack>/<name>.zip archives found under $LEV_ROOT" >&2
  exit 1
fi
echo ""
echo "done: $total_bmm/$total_zip .lev files converted across $zips pack zip(s) -> $BMM_OUT"
echo "(any shortfall = source .lev files that are corrupt or have no polygons; lev2bmm reports each)"
