#!/bin/zsh
# Reruns gallery views many times, keeping every image, for scripts/playtest/darkscan.mjs to scan.
#   zsh scripts/playtest/hunt.sh shots/round3/perf/hunt 20 cars car-very moorhouse square
cd "$(dirname "$0")/../.."
out=$1; runs=$2; shift 2
for i in $(seq -w 1 $runs); do
  for f in "$@"; do
    zsh scripts/gallery.sh "$out/r$i" "$f" | sed "s/^/r$i /"
  done
done
