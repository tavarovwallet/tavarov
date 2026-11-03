# Getting NoN Wallet into F-Droid

`com.tavarov.wallet.yml` is the build recipe F-Droid needs. It goes into
F-Droid's own repository, [fdroiddata](https://gitlab.com/fdroid/fdroiddata),
as `metadata/com.tavarov.wallet.yml`, through a merge request on GitLab.

## Before the merge request

1. The "Android build" check on GitHub Actions is green for the commit you
   want to publish.
2. That commit is tagged `wallet-v<versionName>`, for example `wallet-v1.1.0`,
   and the tag is pushed. The recipe builds from the tag.

## The merge request

1. Sign in to GitLab and fork https://gitlab.com/fdroid/fdroiddata.
2. In the fork, create a branch named `com.tavarov.wallet`.
3. Add the file `metadata/com.tavarov.wallet.yml` with the contents of
   `com.tavarov.wallet.yml` from this folder.
4. Open a merge request into `fdroid/fdroiddata:master`, choose the
   **App inclusion** template and fill it in. The text below can be pasted
   into it.
5. The pipeline runs `fdroid lint` and a real `fdroid build`. Fix anything it
   reports in this repository, move the tag if needed, and push again.

## Text for the merge request

```
New app: NoN Wallet (com.tavarov.wallet)

Self-custody wallet and payment till for USDT and USDC on BNB Chain,
Ethereum, Base and Solana. I am the developer.
Source: https://github.com/tavarovwallet/tavarov (MIT)

Build notes
- Capacitor app built with Gradle only. Capacitor 6.2.1 and
  @capgo/capacitor-native-biometric 6.0.4 are vendored as source, unchanged,
  in android-app/vendor (both MIT).
- prebuild copies the wallet web app (www/, plain HTML and JavaScript with no
  build step) into the assets with android-app/sync-www.sh.
- No Google Play services and no Firebase. Dependencies come from Google's
  Maven and Maven Central. The release build is unsigned unless a local
  keystore.properties exists.
- site/downloads holds a zip of our WooCommerce plugin, unrelated to the app,
  hence scandelete.
- www/lib contains third-party minified libraries used by the wallet:
  ethers 5.7.2 (MIT), TweetNaCl (public domain), qr-scanner by Nimiq (MIT)
  and QRCode.js (MIT). coin-logos.js and tokens-top.js are our own data
  files.

Anti-features
- NonFreeNet: public blockchain RPC nodes, CoinGecko prices, KyberSwap,
  Jupiter and Relay swaps, optional MoonPay, Transak and Onramper card
  top-ups.

Store texts, icon and screenshots: fastlane/metadata/android (en-US, ru-RU).
```

## After inclusion

New versions need no further merge requests: raise `versionCode` and
`versionName` in `../android/app/build.gradle`, add a changelog in
`fastlane/metadata/android/en-US/changelogs/`, and push a new `wallet-v*`
tag. F-Droid picks it up by itself.

F-Droid signs the APK with its own key. An APK signed with any other key (for
example one downloaded from tavarov.com) cannot be updated by the F-Droid
version: the user would have to uninstall it first, which deletes the wallet
from the phone. Anyone doing that needs their 12-word recovery phrase.
