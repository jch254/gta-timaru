#!/bin/zsh
# The frame-rate table in docs/REPORT.md: five places twice each at High, Cathedral Square at the other three
# settings, and the highway drive. Needs the dev server running (pnpm dev -- --port 5195). About six minutes.
#   zsh scripts/playtest/measure.sh
cd "$(dirname "$0")/../.."
out=shots/measure.png
for args in \
  "--place timaru-spawn --time 10" \
  "--at 1150,-4420 --heading 1.57 --time 16" \
  "--place antigua-boatsheds --time 11 --look 0.6,0.2,1.6" \
  "--place cathedral-square --look 3.4,0.12,1 --time 15" \
  "--place four-aves-start --car v8sedan --time 22 --weather southerly --look 1.57,0.16,1"; do
  echo "== $args"
  for i in 1 2; do
    node scripts/shot.mjs ${=args} --wait 10 --fps 6 --size 1920x1080 --out $out 2>&1 | grep -E "^fps|PROBLEMS|console:|http " | cut -c1-110
  done
done
for q in low medium ultra; do
  echo "== cathedral-square at $q"
  node scripts/shot.mjs --quality $q --place cathedral-square --look 3.4,0.12,1 --time 15 --wait 10 --fps 6 --size 1920x1080 --out $out 2>&1 | grep -E "^fps|PROBLEMS|console:|http " | cut -c1-110
done
echo "== highway"
node scripts/shot.mjs --place timaru-spawn --time 15 --wait 0.2 --fps 1 --size 1920x1080 --out $out --eval "$(cat scripts/playtest/highway.js)" 2>&1 | grep -E "^eval|PROBLEMS|console:|http " | cut -c1-300
