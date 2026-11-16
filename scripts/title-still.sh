#!/bin/zsh
# Retakes the title screen's photograph (src/assets/ui/title.jpg) from the running game. From the project root,
# with the dev server up on :5195:
#   zsh scripts/title-still.sh
#
# The view: Mack on the Bay Hill, Timaru, at dusk, looking over Caroline Bay, a V8 parked by the fence. It is
# taken wide (2560 × 1080) and the left 1920 kept, so he stands right of centre, clear of the wordmark.
# still.mjs then fades it like an old colour print and keeps it under 240 KB.
RAW=shots/title-still-raw.png
node scripts/shot.mjs --place timaru-spawn --time ${TIME:-20.7} --weather ${WEATHER:-clear} --quality ultra \
  --size 2560x1080 --look ${YAW:-2.75},0.03,1.35 --wait 6 --out $RAW \
  --eval "const v = dev.ctx.vehicles.spawn('v8sedan', 509.5, 4749.2, 1.9, { tags: ['owned'] }); if (v) v.headlightsOn = true;" \
  && node scripts/title-still.mjs $RAW --crop ${CROP:-0,0,1920,1080} --out src/assets/ui/title.jpg
