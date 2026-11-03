# NoN Wallet for Android

The Android app is a thin [Capacitor](https://capacitorjs.com) shell around the
wallet in [`../www`](../www): the same single-page app that runs at
wallet.tavarov.com, packaged so it works offline and can unlock with a
fingerprint.

* Application ID: `com.tavarov.wallet`
* Licence: MIT, like the rest of the repository
* No Google Play services, no Firebase, no trackers, no prebuilt libraries in the
  repository. Gradle downloads everything from Google's Maven and Maven Central.

## Layout

```
android-app/
  android/      Gradle project (the app module is android/app)
  vendor/       Capacitor 6.2.1 and the biometric plugin, as source (see vendor/README.md)
  sync-www.sh   copies ../www into the app's assets before a build
```

Node.js is not needed to build: Capacitor is vendored as source and the web
assets are copied by `sync-www.sh`.

## Build

Requirements: JDK 17 or 21 and the Android SDK (Android Studio installs both).

```bash
sh android-app/sync-www.sh
cd android-app/android
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release-unsigned.apk
```

Without `android/keystore.properties` the release APK is unsigned; that is what
F-Droid wants. To sign your own builds, copy `keystore.properties.example` to
`keystore.properties` and fill it in. **Never commit a keystore or its
passwords**: whoever has the key can publish an "update" of this wallet.

## F-Droid

F-Droid builds this app from source with the recipe in
[`fdroid/com.tavarov.wallet.yml`](fdroid/com.tavarov.wallet.yml): it checks out
the `wallet-v*` tag, runs `sync-www.sh`, builds `assembleRelease` and signs the
APK with its own key. Store texts and screenshots are in
[`../fastlane/metadata/android`](../fastlane/metadata/android).

To release a new version:

1. Raise `versionCode` and `versionName` in `android/app/build.gradle`.
2. Add `../fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`.
3. Commit, then tag it: `git tag wallet-v<versionName> && git push --tags`.

F-Droid notices the new tag by itself and builds it, usually within a few days.
