/* Код Authenticator, который не меняется.

   Раньше секрет второго рубежа был случайным. Значит при восстановлении
   кошелька из seed-фразы рождался новый: тот же кошелёк, тот же хозяин — а
   в Authenticator появлялась вторая запись, и приходилось гадать, какая из
   них рабочая. Человек, прошедший это дважды, выключает код совсем, и
   второго рубежа не остаётся вовсе. Неудобство здесь и есть дыра.

   Теперь секрет выводится из самой фразы. Здесь проверяется, что он:

   1. один и тот же для одной фразы — всегда, хоть на десятом заходе;
   2. разный для разных фраз;
   3. случайный там, где фразы нет (кошелёк по приватному ключу);
   4. настоящий рабочий секрет, а не просто одинаковая строка: по нему
      считается код, и приложение его принимает.

   И отдельно: сама фраза из секрета не восстанавливается. Иначе запись в
   Authenticator, которую человек показывает на экране кому попало, стоила
   бы ему кошелька.                                                        */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const e = require('/home/claude/apk/www/lib/ethers.umd.min.js'); const E = e.ethers || e;

const srv = await start(8555);
const R = reporter();

const A = E.Wallet.createRandom().mnemonic.phrase;
const B = E.Wallet.createRandom().mnemonic.phrase;

const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555', raw: true });

const secretFor = (phrase) => page.evaluate(async (m) => {
  const w = await walletFromMnemonicAll(m);
  return await totpSecretFor(w);
}, phrase);

// ---------- одна фраза — один секрет ----------
const a1 = await secretFor(A);
const a2 = await secretFor(A);
R.ok('СЕКРЕТ ОДИН И ТОТ ЖЕ ДЛЯ ОДНОЙ ФРАЗЫ', a1 === a2, a1.slice(0, 10) + '… / ' + a2.slice(0, 10) + '…');

/* Перезагружаем страницу целиком: секрет не должен зависеть ни от чего,
   что живёт в памяти вкладки. */
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => typeof totpSecretFor === 'function');
const a3 = await secretFor(A);
R.ok('и он переживает перезагрузку приложения', a3 === a1, a3.slice(0, 10) + '…');

const b1 = await secretFor(B);
R.ok('У ДРУГОЙ ФРАЗЫ СЕКРЕТ ДРУГОЙ', b1 !== a1, b1.slice(0, 10) + '…');

/* Регистр и лишние пробелы в фразе — оформление, а не другая фраза. */
const aLoud = await secretFor(A.toUpperCase().split(' ').join('   '));
R.ok('заглавные буквы и лишние пробелы секрет не меняют', aLoud === a1, aLoud.slice(0, 10) + '…');

// ---------- формат ----------
R.ok('секрет нужной длины и только из букв base32',
  /^[A-Z2-7]{32}$/.test(a1), a1.length + ' знаков');

// ---------- кошелёк без фразы ----------
/* По приватному ключу фразы нет. Тогда секрет остаётся случайным — и это
   правда случайный, а не пустой и не одинаковый у всех. */
const noPhrase = await page.evaluate(async () => {
  const w = { mnemonic: null, evm: { address: '0x' + '11'.repeat(20) } };
  return [await totpSecretFor(w), await totpSecretFor(w)];
});
R.ok('БЕЗ ФРАЗЫ СЕКРЕТ СЛУЧАЙНЫЙ, А НЕ ОБЩИЙ ДЛЯ ВСЕХ',
  noPhrase[0] !== noPhrase[1] && /^[A-Z2-7]{32}$/.test(noPhrase[0]),
  noPhrase[0].slice(0, 10) + '… / ' + noPhrase[1].slice(0, 10) + '…');

// ---------- по нему считается настоящий код ----------
/* Одинаковая строка сама по себе ничего не стоит: надо, чтобы приложение
   приняло посчитанный по ней код — теми же функциями, какими оно проверяет
   код у живого человека. */
const works = await page.evaluate(async (sec) => {
  const step = Math.floor(Date.now() / 1000 / 30);
  const code = await totpAt(base32Decode(sec), step);
  return { code: code, ok: await totpVerifyCode(sec, code),
           badOk: await totpVerifyCode(sec, code === '000000' ? '111111' : '000000') };
}, a1);
R.ok('ПО СЕКРЕТУ СЧИТАЕТСЯ КОД, И ПРИЛОЖЕНИЕ ЕГО ПРИНИМАЕТ',
  works.ok === true && /^\d{6}$/.test(works.code), works.code);
R.ok('а чужой код не принимает', works.badOk === false);

// ---------- фраза из секрета не достаётся ----------
/* Запись в Authenticator человек показывает на экране, фотографирует и
   пересылает. Если бы из неё выводилась фраза, это был бы кошелёк в
   открытом виде. */
R.ok('В СЕКРЕТЕ НЕТ НИ ОДНОГО СЛОВА ФРАЗЫ',
  !A.split(' ').some(w => a1.toLowerCase().includes(w)), a1.slice(0, 16) + '…');

// ---------- запись в Authenticator различима ----------
/* У человека может быть два кошелька. Две одинаковые строки «Tavarov
   Wallet» в приложении кодов не различить никак. */
const uri = await page.evaluate(async (m) => {
  const w = await walletFromMnemonicAll(m);
  return totpUri(await totpSecretFor(w), w.evm.address);
}, A);
const addr = await page.evaluate(async (m) => (await walletFromMnemonicAll(m)).evm.address, A);
R.ok('В ЗАПИСИ ВИДЕН АДРЕС КОШЕЛЬКА, А НЕ ПРОСТО «WALLET»',
  uri.includes(encodeURIComponent(addr.slice(0, 6))), decodeURIComponent(uri).slice(0, 60));
R.ok('и сам секрет в записи тот же', uri.includes('secret=' + a1));

const clean = errors.filter(x => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(x));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
