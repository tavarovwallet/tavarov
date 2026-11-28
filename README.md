# android-apk

This branch holds one file: `tavarov.apk`, the signed NoN Wallet for Android
that tavarov.com serves. It is kept out of `main` on purpose: `*.apk` is
ignored there, and F-Droid must not find binaries in the source.

The deploy workflow on `main` copies this file to tavarov.com/tavarov.apk and
refuses to deploy if its SHA-256 differs from `site/apk.json`. The same
workflow publishes it once as the GitHub release named in `site/apk.json`.

Current file: NoN Wallet 1.1.5 (versionCode 39), built by GitHub Actions from
commit 4a55dfb5eb86c017ad2229cc918a10690cac45fd and signed with the
tavarov.com key (certificate SHA-256
AB9F235464A5F2B47BCF38DE47439BB5751860FB86F131BC6E0C8A75D87A8AB1).

SHA-256 of tavarov.apk:
f4ebb1732af5a250a5dd8cbbe253130505c4867bca05f52d60be6a456d0400b3
