/* Разрешения собранного приложения.

   Живой случай, найденный перед самым выходом. В браузере сканер QR работал,
   а в манифесте Android разрешения на камеру не было вовсе. В собранном
   приложении это выглядело бы так: человек жмёт «сканировать», система молча
   отказывает, на экране чёрный прямоугольник. Проверить это в браузере
   невозможно в принципе — там камера спрашивается иначе.

   Обратная опасность не меньше: лишние разрешения. Кошелёк, который просит
   доступ к контактам или к местоположению, выглядит ровно как то, от чего мы
   людей отговариваем, и в Google Play такое разбирают под лупой.

   Поэтому здесь сверяется список разрешений целиком: что нужное есть, а
   лишнего нет. Файл читается прямо с диска — браузер для этого не нужен. */
import { reporter } from './boot.mjs';
import fs from 'node:fs';

const R = reporter();
const path = '/home/claude/apk/android-fix/AndroidManifest.xml';
const x = fs.readFileSync(path, 'utf-8');

const perms = [...x.matchAll(/uses-permission android:name="android\.permission\.([A-Z_]+)"/g)]
  .map(m => m[1]);

R.ok('ИНТЕРНЕТ РАЗРЕШЁН — БЕЗ НЕГО КОШЕЛЁК НЕ УВИДИТ СЕТЬ',
  perms.includes('INTERNET'), perms.join(', '));
R.ok('КАМЕРА РАЗРЕШЕНА — ИНАЧЕ СКАНЕР QR НЕ РАБОТАЕТ В СОБРАННОМ ПРИЛОЖЕНИИ',
  perms.includes('CAMERA'), perms.join(', '));

/* Камера объявлена необязательной: платить и принимать переводы можно и без
   неё, а required="true" убрало бы приложение из выдачи для части устройств. */
R.ok('камера объявлена необязательной',
  /uses-feature android:name="android\.hardware\.camera" android:required="false"/.test(x));

const forbidden = ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'READ_CONTACTS',
                   'READ_SMS', 'RECEIVE_SMS', 'READ_PHONE_STATE', 'RECORD_AUDIO',
                   'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'QUERY_ALL_PACKAGES'];
const extra = perms.filter(p => forbidden.includes(p));
R.ok('ЛИШНИХ РАЗРЕШЕНИЙ НЕТ — НИ МЕСТОПОЛОЖЕНИЯ, НИ КОНТАКТОВ, НИ SMS',
  extra.length === 0, extra.join(', ') || 'ничего лишнего');
R.ok('и всего разрешений ровно два', perms.length === 2, 'их ' + perms.length + ': ' + perms.join(', '));

/* Резервные копии Android. Кошелёк с ключами не должен уезжать в чужое
   облако автоматически: копию человек делает сам и своим паролем. */
R.ok('АВТОМАТИЧЕСКАЯ КОПИЯ В ОБЛАКО ВЫКЛЮЧЕНА', /android:allowBackup="false"/.test(x));
R.ok('правила извлечения данных заданы',
  /android:dataExtractionRules="@xml\/data_extraction_rules"/.test(x)
  && /android:fullBackupContent="@xml\/backup_rules"/.test(x));
R.ok('ОБМЕН ПО ОТКРЫТОМУ HTTP ЗАПРЕЩЁН', /android:usesCleartextTraffic="false"/.test(x));

/* Файл из папки android-fix — это наш образец. Он бесполезен, если не
   попал в сам проект: там его читает сборка. */
const live = '/mnt/user-data/uploads/wallet-apk-project/android/app/src/main/AndroidManifest.xml';
if (fs.existsSync(live)){
  const l = fs.readFileSync(live, 'utf-8');
  R.ok('в проекте на компьютере разрешение на камеру тоже есть',
    /android\.permission\.CAMERA/.test(l),
    'снимок проекта от последней выгрузки');
}

const good = R.done([]);
process.exit(good ? 0 : 1);
