/* 28.11.2026: версия в подвале кошелька (APP_VERSION) отстала от Android-сборки:
   вышла 1.1.5, а в настройках писало 1.1.4. Теперь сверяем с build.gradle. */
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'www/index.html'), 'utf8');
const gradle = fs.readFileSync(path.join(root, 'android-app/android/app/build.gradle'), 'utf8');
const app = (html.match(/const APP_VERSION = '([^']+)'/) || [])[1];
const name = (gradle.match(/versionName "([^"]+)"/) || [])[1];
const ok = app && app === name;
console.log((ok ? 'OK   ' : 'ПРОВАЛ ') + 'версия кошелька совпадает с Android-сборкой  [' + app + ' / ' + name + ']');
const ios = /IS_NATIVE \? \(IS_IOS \?/.test(html);
console.log((ios ? 'OK   ' : 'ПРОВАЛ ') + 'в приложении под iOS не пишется «Android»');
if (!ok || !ios) process.exit(1);
