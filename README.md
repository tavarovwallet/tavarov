# android-apk

This branch holds one file: `tavarov.apk`, the signed NoN Wallet for Android
that tavarov.com serves. It is kept out of `main` on purpose: `*.apk` is
ignored there, and F-Droid must not find binaries in the source.

The deploy workflow on `main` copies this file to tavarov.com/tavarov.apk and
refuses to deploy if its SHA-256 differs from `site/apk.json`. The same
workflow publishes it once as the GitHub release named in `site/apk.json`.

Current file: NoN Wallet 1.1.4 (versionCode 38), built by GitHub Actions from
commit d35e7d9e7e9fdccff7fb85b8be46396db027aa4d and signed with the
tavarov.com key (certificate SHA-256
AB9F235464A5F2B47BCF38DE47439BB5751860FB86F131BC6E0C8A75D87A8AB1).

SHA-256 of tavarov.apk:
7f46b8a60646cd6c3b7a99d9bb8f83d098b138bb4bb00e75442cdafc6a0f8a23
