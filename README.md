# android-apk

This branch holds one file: `tavarov.apk`, the signed NoN Wallet for Android
that tavarov.com serves. It is kept out of `main` on purpose: `*.apk` is
ignored there, and F-Droid must not find binaries in the source.

The deploy workflow on `main` copies this file to tavarov.com/tavarov.apk and
refuses to deploy if its SHA-256 differs from `site/apk.json`. The same
workflow publishes it once as the GitHub release named in `site/apk.json`.

Current file: NoN Wallet 1.1.6 (versionCode 40), built by GitHub Actions from
commit e461519f90dd533b51c841f5f8e5ede7e567a183 and signed with the
tavarov.com key (certificate SHA-256
AB9F235464A5F2B47BCF38DE47439BB5751860FB86F131BC6E0C8A75D87A8AB1).

SHA-256 of tavarov.apk:
37a2b10ffb500bb2888567101788a94ff34569199a42cdf94fdec05f42f9f553
