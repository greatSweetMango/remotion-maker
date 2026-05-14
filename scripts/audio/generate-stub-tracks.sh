#!/usr/bin/env bash
# TM-127 — generate stub mp3 tracks for audio catalogue (fixture only).
# Real curation happens in a separate task; this script lets the schema/loader
# pipeline land independently. ADR-0026 §1.
#
# Usage: bash scripts/audio/generate-stub-tracks.sh
#   - regenerates every public/audio/<slug>.mp3 from the catalogue spec below
#   - rewrites public/audio/MANIFEST.json with fresh sha256 hashes
#
# Requires: ffmpeg, shasum (macOS) or sha256sum (linux), node (for JSON write).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$ROOT/public/audio"
MANIFEST="$OUT_DIR/MANIFEST.json"
mkdir -p "$OUT_DIR"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required" >&2
  exit 1
fi

if command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  sha256() { sha256sum "$1" | awk '{print $1}'; }
fi

# slug | mood | bpm | duration | freq | license | attribution
TRACKS=(
  "chill-sunrise|chill|72|10|220|CC0-1.0|EasyMake stub (sine 220Hz)"
  "chill-driftwood|chill|68|10|247|CC0-1.0|EasyMake stub (sine 247Hz)"
  "chill-hazelight|chill|76|10|262|CC0-1.0|EasyMake stub (sine 262Hz)"
  "upbeat-runner|upbeat|128|10|440|CC0-1.0|EasyMake stub (sine 440Hz)"
  "upbeat-popfizz|upbeat|124|10|466|CC0-1.0|EasyMake stub (sine 466Hz)"
  "upbeat-skylark|upbeat|132|10|494|CC0-1.0|EasyMake stub (sine 494Hz)"
  "cinematic-horizon|cinematic|90|10|330|CC0-1.0|EasyMake stub (sine 330Hz)"
  "cinematic-aurora|cinematic|84|10|349|CC0-1.0|EasyMake stub (sine 349Hz)"
  "cinematic-monolith|cinematic|96|10|370|CC0-1.0|EasyMake stub (sine 370Hz)"
  "lofi-cassette|lofi|82|10|196|CC0-1.0|EasyMake stub (sine 196Hz)"
  "lofi-rainpane|lofi|80|10|208|CC0-1.0|EasyMake stub (sine 208Hz)"
  "lofi-deskloop|lofi|78|10|175|CC0-1.0|EasyMake stub (sine 175Hz)"
  "electronic-pulse|electronic|140|10|587|CC0-1.0|EasyMake stub (sine 587Hz)"
  "electronic-neondrive|electronic|136|10|622|CC0-1.0|EasyMake stub (sine 622Hz)"
  "electronic-circuit|electronic|144|10|659|CC0-1.0|EasyMake stub (sine 659Hz)"
)

ENTRIES=()
for row in "${TRACKS[@]}"; do
  IFS='|' read -r slug mood bpm dur freq license attribution <<<"$row"
  out="$OUT_DIR/$slug.mp3"
  echo "  → $slug.mp3 ($mood, ${freq}Hz, ${dur}s)"
  ffmpeg -y -hide_banner -loglevel error \
    -f lavfi -i "sine=frequency=${freq}:duration=${dur}" \
    -b:a 192k "$out"
  hash="$(sha256 "$out")"
  size=$(wc -c <"$out" | tr -d ' ')
  ENTRIES+=("{\"filename\":\"${slug}.mp3\",\"mood\":\"${mood}\",\"bpm\":${bpm},\"durationSec\":${dur},\"license\":\"${license}\",\"attribution\":\"${attribution}\",\"sha256\":\"${hash}\",\"bytes\":${size}}")
done

# Build manifest JSON via node so formatting is deterministic.
node -e "
  const entries = process.argv.slice(1).map(s => JSON.parse(s));
  const doc = {
    \$schema: 'https://easymake.dev/schemas/audio-manifest.v1.json',
    version: 1,
    note: 'TM-127 stub catalogue. ffmpeg-generated sine tones; replace with curated CC0/MIT-0 tracks before launch.',
    tracks: entries,
  };
  process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
" "${ENTRIES[@]}" > "$MANIFEST"

echo "wrote $MANIFEST (${#ENTRIES[@]} tracks)"
