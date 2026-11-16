#!/bin/zsh
# The same fixed views every time, for before-and-after comparisons of how the game looks.
# Needs the dev server running on port 5195.
#
#   zsh scripts/gallery.sh shots/before            every view (about four minutes)
#   zsh scripts/gallery.sh shots/after square      only views whose name contains "square"
#
# Each line of output is the view's name with its draw calls and triangles (shadow passes included); those two
# numbers do not depend on how busy the machine is, so they are the ones to compare. For frame rate use
# scripts/playtest/measure.sh on a quiet machine.
cd "$(dirname "$0")/.."
out=${1:-shots/gallery}
only=${2:-}
mkdir -p "$out"

view() {
  local name=$1
  shift
  if [[ -n "$only" && "$name" != *"$only"* ]]; then return; fi
  local line
  line=$(node scripts/shot.mjs "$@" --out "$out/$name.jpg" 2>&1 | grep -E "^stats|PROBLEMS|console:|http " | head -3 | tr '\n' ' ')
  local calls=$(echo "$line" | sed -nE 's/.*"calls":([0-9]+).*/\1/p')
  local tris=$(echo "$line" | sed -nE 's/.*"tris":([0-9]+).*/\1/p')
  local problems=""
  [[ "$line" == *PROBLEMS* || "$line" == *console:* ]] && problems="  PROBLEMS: ${line:0:160}"
  printf "%-26s calls=%-5s tris=%-8s%s\n" "$name" "$calls" "$tris" "$problems"
}

# Timaru
view 01-bay-hill          --place timaru-spawn --time 9.7
view 02-stafford-street   --at 451,4950 --heading 0 --time 16 --look 0,0.12,1.3
view 03-caroline-bay      --place caroline-bay --time 11 --look 2.2,0.16,1.6
view 04-timaru-port       --place timaru-port-lockup --time 8 --look 1.0,0.18,1.8
# The road north
view 05-rakaia            --place rakaia-salmon --time 14 --look 0.8,0.2,2
view 06-plains-norwester  --at -1318,-1700 --time 17.6 --weather norwester --look 0.3,0.12,1.4
view 07-temuka            --place temuka-pub --time 12 --look 1.9,0.14,1.4
# Christchurch
view 08-square            --place cathedral-square --time 15 --look 3.4,0.12,1
view 09-square-night      --place cathedral-square --time 21.5 --look 3.4,0.12,1
view 10-square-overcast   --place cathedral-square --time 12 --weather overcast --look 0.6,0.14,1.2
view 11-arts-centre       --place arts-centre --time 10 --look 2.6,0.14,1.4
view 12-avon-hagley       --place antigua-boatsheds --time 10.5 --look 0.6,0.16,1.6
view 13-linwood           --at 1150,-4420 --heading 1.57 --time 17 --look 1.2,0.14,1.2
view 14-lancaster-park    --place lancaster-park --time 15 --look 0.9,0.14,1.4
view 15-moorhouse-rain    --place four-aves-start --car v8sedan --time 21.6 --weather southerly --wait 14 --look 1.57,0.16,1
view 16-moorhouse-dusk    --place four-aves-start --car coupe --time 19.3 --look 2.2,0.14,1
view 17-new-brighton      --place new-brighton-beach --time 13 --look 1.2,0.16,1.6
view 18-summit-road       --place sign-of-the-kiwi --time 18.4 --weather norwester --look 3.6,0.1,1.4
view 19-lyttelton         --place lyttelton-wharf --time 16 --look 2.4,0.2,2
view 20-fog               --place antigua-boatsheds --time 7.2 --weather fog --look 2.4,0.14,1.4
# Close up: a car, a figure, a wall
view 21-cars-close        --place four-aves-start --time 15 --wait 3 --eval "const p=dev.ctx.player.position; ['statesman','v8sedan','coupe','hatch','wagon','ute'].forEach((id,i)=>dev.ctx.vehicles.spawn(id,p.x+6,p.z-8+i*3.4,Math.PI/2,{tags:['owned']})); dev.look(Math.PI/2-0.5,0.22,1.5);"
view 22-car-very-close    --place four-aves-start --car statesman --time 16.5 --look 0.9,0.1,0.55
view 23-figure-close      --place cathedral-square --time 13 --look 0.2,0.05,0.5
view 24-shopfront-close   --at 453,4950 --heading 1.57 --time 14.5 --look 1.57,0.05,0.75
