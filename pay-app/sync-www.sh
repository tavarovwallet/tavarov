#!/bin/sh
# Copies the Tavarov Pay web app (pay-app/www) into the Android app's assets,
# the same thing `npx cap copy` would do. Run it before every Android build.
set -eu
cd "$(dirname "$0")"
DEST=android/app/src/main/assets/public
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R www/. "$DEST/"
echo "sync-www: $(find "$DEST" -type f | wc -l | tr -d ' ') files copied to pay-app/$DEST"
