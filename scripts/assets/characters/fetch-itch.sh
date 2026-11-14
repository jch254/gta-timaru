#!/bin/sh
# Fetch the free ("name your own price", minimum $0) Standard zip of an itch.io asset pack without an account.
# usage: fetch-itch.sh <author> <game-slug> <upload-name-substring> <out-dir>
set -eu
AUTHOR="$1"; GAME="$2"; MATCH="$3"; OUT="$4"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
BASE="https://$AUTHOR.itch.io/$GAME"
mkdir -p "$OUT"
JAR="$OUT/.cookies"
PAGE="$OUT/.page.html"
curl -sSL -A "$UA" -c "$JAR" -o "$PAGE" "$BASE"
CSRF=$(grep -oE 'name="csrf_token" value="[^"]+"' "$PAGE" | head -1 | sed -E 's/.*value="([^"]+)"/\1/')
DL=$(curl -sS -A "$UA" -b "$JAR" -c "$JAR" -H "X-Requested-With: XMLHttpRequest" -e "$BASE" --data-urlencode "csrf_token=$CSRF" "$BASE/download_url" | sed -E 's/.*"url":"([^"]+)".*/\1/' | sed 's#\\/#/#g')
echo "download page: $DL"
curl -sSL -A "$UA" -b "$JAR" -c "$JAR" -o "$OUT/.downloads.html" "$DL"
# upload rows: <a data-upload_id="123" …>Download</a> … <strong title="File name.zip" class="name">
python3 -I - "$OUT/.downloads.html" "$MATCH" > "$OUT/.upload" <<'PY'
import re, sys
s = open(sys.argv[1], encoding='utf-8', errors='replace').read()
for m in re.finditer(r'data-upload_id="(\d+)".{0,600}?<strong[^>]*title="([^"]+)"', s, flags=re.S):
    if sys.argv[2] in m.group(2):
        print(m.group(1)); print(m.group(2)); break
PY
ID=$(sed -n 1p "$OUT/.upload"); NAME=$(sed -n 2p "$OUT/.upload")
[ -n "$ID" ] || { echo "no upload matching '$MATCH'"; exit 1; }
URL=$(curl -sS -A "$UA" -b "$JAR" -H "X-Requested-With: XMLHttpRequest" -e "$DL" --data-urlencode "csrf_token=$CSRF" "$BASE/file/$ID?source=game_download" | sed -E 's/.*"url":"([^"]+)".*/\1/' | sed 's#\\/#/#g')
echo "fetching $NAME (upload $ID)"
curl -sSL -A "$UA" -o "$OUT/$NAME" "$URL"
ls -la "$OUT/$NAME"
