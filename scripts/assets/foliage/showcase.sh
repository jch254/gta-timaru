#!/bin/zsh
# Stands plant kinds in rows in front of the player in the running game and takes a picture (dev server needed).
#   zsh scripts/assets/foliage/showcase.sh out.jpg "bush,rose-bush,flower-bed" [dist] [gap] [rows] [time] [look]
# WHERE="--place cathedral-square --heading 3.4" puts them somewhere other than the paddock by default.
cd "$(dirname "$0")/../../.."
out=$1; kinds=$2; dist=${3:-9}; gap=${4:-2.6}; rows=${5:-3}; time=${6:-15}; look=${7:-3.14,0.2,0.6}
list="['${kinds//,/','}']"
where=${WHERE:---at -1318,-1300 --heading 3.14}
node scripts/shot.mjs ${=where} --time $time --look $look --out "$out" \
  --eval "const m = await import('/dev/veg-showcase.ts'); return m.show(dev, $list, { dist: $dist, gap: $gap, rows: $rows })" 2>&1 | grep -E "^eval|^stats" | cut -c1-400
