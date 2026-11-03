#!/bin/sh
# Copies the NoN Wallet web app (../www) into the Android app's assets,
# the same thing `npx cap copy` would do. Run it before every Android build;
# F-Droid runs it as the prebuild step.
set -eu
cd "$(dirname "$0")"
DEST=android/app/src/main/assets/public
rm -rf "$DEST"
mkdir -p "$DEST"
cp -R ../www/. "$DEST/"
# Cloudflare Pages settings, not part of the app.
rm -f "$DEST/_headers" "$DEST/_redirects"
echo "sync-www: $(find "$DEST" -type f | wc -l | tr -d ' ') files copied to android-app/$DEST"
