# Vendored Android libraries

Copied unchanged from the npm packages so the app builds with Gradle alone,
without Node.js. Both are MIT-licensed; their licence files are kept next to
the code.

| Folder | npm package | Version | Upstream |
|---|---|---|---|
| `capacitor-android/` | `@capacitor/android` | 6.2.1 | https://github.com/ionic-team/capacitor |
| `capacitor-native-biometric/` | `@capgo/capacitor-native-biometric` | 6.0.4 | https://github.com/Cap-go/capacitor-native-biometric |

Left out: the iOS parts, tests, and the plugin's standalone Gradle wrapper,
settings and properties files (the plugin is built as a module of
`../android`).

To update, copy the same paths from a newer npm package
(`node_modules/@capacitor/android/{LICENSE,package.json,capacitor/}` and
`node_modules/@capgo/capacitor-native-biometric/{LICENSE,package.json,android/}`)
and change the versions in this table.
