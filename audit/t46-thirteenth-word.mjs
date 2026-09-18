/* Тринадцатое слово.

   Двенадцать слов у человека выманивают. Не взламывают, не подбирают —
   именно выманивают: «поддержка» просит их «для проверки», и человек
   отдаёт. Сколько ни пиши на экране «никто не попросит фразу», часть людей
   отдаёт всё равно. Замок на нашем входе тут не помогает вовсе: вор с
   фразой идёт не к нам, а в любой другой кошелёк.

   Тринадцатое слово меняет не вход, а саму математику. Оно подмешивается в
   вывод ключей, и те же двенадцать слов с другим тринадцатым дают ДРУГОЙ
   кошелёк. Выманили двенадцать — открыли пустоту, где угодно.

   Здесь проверяется главное:

   1. Пустое слово даёт ровно тот же кошелёк, что и раньше. Иначе все, кто
      завёл кошелёк до этого дня, увидели бы в одно обновление чужой адрес
      и нулевой баланс — и это была бы катастрофа хуже любой кражи.
   2. Со словом адреса другие — во всех трёх сетях сразу.
   3. Разные слова — разные кошельки.
   4. Слово живёт в зашифрованном хранилище и возвращается при открытии:
      иначе человек задал бы его и не смог войти завтра.
   5. Код Authenticator тоже считается со словом: два кошелька из одной
      фразы обязаны иметь разные коды.                                    */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const e = require('/home/claude/apk/www/lib/ethers.umd.min.js'); const E = e.ethers || e;

const srv = await start(8555);
const R = reporter();
const PHRASE = E.Wallet.createRandom().mnemonic.phrase;

const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555', raw: true });

const mk = (m, p) => page.evaluate(async ([mm, pp]) => {
  const w = await walletFromMnemonicAll(mm, pp);
  return { evm: w.evm.address, tron: w.tron.address, sol: w.solana.address, pass: w.pass,
           totp: await totpSecretFor(w) };
}, [m, p]);

// ---------- без слова всё как было ----------
const plain = await mk(PHRASE, '');
const plainUndef = await mk(PHRASE, undefined);
/* Сверяем с независимым выводом библиотеки, а не с самим собой: иначе
   проверка подтвердила бы любую нашу ошибку, лишь бы она была устойчивой. */
const expected = E.Wallet.fromMnemonic(PHRASE).address;
R.ok('БЕЗ ТРИНАДЦАТОГО СЛОВА АДРЕС ТОТ ЖЕ, ЧТО И РАНЬШЕ',
  plain.evm.toLowerCase() === expected.toLowerCase(), plain.evm);
R.ok('пустая строка и «ничего» — одно и то же',
  plain.evm === plainUndef.evm && plain.tron === plainUndef.tron && plain.sol === plainUndef.sol);
R.ok('и слово при этом не записано', plain.pass === null, String(plain.pass));

// ---------- со словом кошелёк другой ----------
const withWord = await mk(PHRASE, 'сорока-восемь');
R.ok('СО СЛОВОМ АДРЕС В BNB CHAIN ДРУГОЙ', withWord.evm !== plain.evm, withWord.evm.slice(0, 14) + '…');
R.ok('и в Tron другой', withWord.tron !== plain.tron);
R.ok('и в Solana другой', withWord.sol !== plain.sol);
R.ok('слово сохранено в кошельке', withWord.pass === 'сорока-восемь');

/* Тот же результат обязан получаться и у чужой библиотеки: иначе человек не
   сможет достать свои деньги ничем, кроме нашего приложения, — а это ровно
   то, от чего мы уходим. */
const outside = E.Wallet.fromMnemonic(PHRASE, undefined, undefined);
const outsideWith = E.utils.HDNode.fromMnemonic(PHRASE, 'сорока-восемь').derivePath("m/44'/60'/0'/0/0");
R.ok('ЧУЖОЙ КОШЕЛЁК ПОСЧИТАЕТ ТО ЖЕ САМОЕ',
  E.utils.computeAddress(outsideWith.privateKey).toLowerCase() === withWord.evm.toLowerCase(),
  'совпало с BIP39');
void outside;

// ---------- разные слова — разные кошельки ----------
const other = await mk(PHRASE, 'другое');
R.ok('РАЗНЫЕ СЛОВА — РАЗНЫЕ КОШЕЛЬКИ', other.evm !== withWord.evm);
const again = await mk(PHRASE, 'сорока-восемь');
R.ok('а одно и то же слово даёт один и тот же кошелёк', again.evm === withWord.evm);

/* Пробел — это знак, а не пустота. «слово» и «слово » должны быть разными,
   иначе человек, случайно скопировавший пробел, попал бы в чужой кошелёк
   и решил, что деньги пропали. Здесь мы обрезаем пробелы в поле ввода
   заранее, поэтому проверяем сам вывод ключей. */
const spaced = await mk(PHRASE, 'сорока-восемь ');
R.ok('лишний пробел в слове даёт другой кошелёк', spaced.evm !== withWord.evm);

// ---------- код Authenticator ----------
R.ok('КОД ТОЖЕ СЧИТАЕТСЯ СО СЛОВОМ, А НЕ ТОЛЬКО С ФРАЗОЙ',
  withWord.totp !== plain.totp, withWord.totp.slice(0, 10) + '…');

// ---------- слово переживает хранилище ----------
const kept = await page.evaluate(async ([m, p]) => {
  const w = await walletFromMnemonicAll(m, p);
  const str = await encryptVault(w, 'testpassword1');
  const back = await decryptVault(str, 'testpassword1');
  return { pass: back.pass, evm: back.evm.address };
}, [PHRASE, 'сорока-восемь']);
R.ok('СЛОВО ВОЗВРАЩАЕТСЯ ИЗ ЗАШИФРОВАННОЙ КОПИИ',
  kept.pass === 'сорока-восемь' && kept.evm === withWord.evm, String(kept.pass));

// ---------- поля на экранах есть ----------
R.ok('поле для слова есть при создании кошелька',
  await page.evaluate(() => !!document.getElementById('genPassInput')));
R.ok('и при восстановлении',
  await page.evaluate(() => !!document.getElementById('importPassInput')));
/* Экран создания при загрузке скрыт, и innerText у скрытого пуст — читаем
   сам текст подписи, а не то, что видно прямо сейчас. */
R.ok('и рядом сказано, что потерянное слово не восстановит никто',
  await page.evaluate(() => {
    const el = document.querySelector('[data-i18n="k63d6bd06"]');
    return !!el && /не вернёт никто/.test(el.textContent);
  }));

const clean = errors.filter(x => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(x));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
