#!/bin/sh
# Download and unpack the raw character packs that build.mjs reads (both CC0, by Quaternius):
#   Universal Base Characters [Standard]   https://quaternius.itch.io/universal-base-characters
#   Universal Animation Library [Standard] https://quaternius.itch.io/universal-animation-library
# into assets-staging/characters/ (git-ignored). Run from the project root.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
STAGING="assets-staging/characters"
sh "$HERE/fetch-itch.sh" quaternius universal-base-characters "Standard" "$STAGING/base"
sh "$HERE/fetch-itch.sh" quaternius universal-animation-library "Standard" "$STAGING/ual1"
rm -rf "$STAGING/x-base" "$STAGING/x-ual1"
mkdir -p "$STAGING/x-base" "$STAGING/x-ual1"
unzip -q -o "$STAGING"/base/*.zip -d "$STAGING/x-base"
unzip -q -o "$STAGING"/ual1/*.zip -d "$STAGING/x-ual1"
echo "Unpacked. Now: node scripts/assets/characters/build.mjs"
