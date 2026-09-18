/* Ввод seed-фразы руками.

   Человек переписывает двенадцать английских слов с бумаги в телефон.
   Ошибается он в одном слове из двенадцати — это норма, а не небрежность.
   А приложение отвечало ему «Ошибка: invalid mnemonic»: не сказано ни какое
   слово не то, ни сколько слов, ни что делать дальше. Найти опечатку
   глазами в сплошной строке из двенадцати слов почти невозможно, и человек
   решает, что потерял кошелёк.

   Здесь проверяется, что приложение разбирает фразу само и говорит по делу:

   1. Не то число слов — сказано, сколько их насчитали.
   2. Слова нет в списке — оно названо, и предложены похожие.
   3. Слова все годные, а фраза не сходится — сказано про порядок, а не
      «invalid mnemonic».
   4. Заглавные буквы, лишние пробелы, переводы строк и запятые — это
      оформление от клавиатуры телефона, а не ошибка человека, и фраза с
      ними обязана приниматься.

   И главное: ни одна проверка не отправляет фразу никуда. Весь разбор — в
   браузере, у человека на устройстве.                                     */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const e = require('/home/claude/apk/www/lib/ethers.umd.min.js'); const E = e.ethers || e;

const srv = await start(8555);
const R = reporter();

/* Фразу берём свежесозданную, а не записанную в проверке: чужая настоящая
   фраза в исходниках — это чужие деньги в открытом виде. */
const GOOD = E.Wallet.createRandom().mnemonic.phrase;
const WORDS = GOOD.split(' ');

const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555', raw: true });
page.on('dialog', d => d.accept().catch(()=>{}));

/* Разбор — чистая функция, и проверять её надо как функцию: без кликов,
   без экранов, на десятке случаев подряд. */
const problem = (text) => page.evaluate(x => {
  const p = seedProblem(x);
  return p === null ? null : String(p);
}, text);

// ---------- хорошая фраза проходит молча ----------
R.ok('ПРАВИЛЬНАЯ ФРАЗА НЕ ВЫЗЫВАЕТ НИКАКИХ ЖАЛОБ',
  (await problem(GOOD)) === null, String(await problem(GOOD)));

// ---------- оформление от телефона — не ошибка ----------
/* Клавиатура ставит заглавную в начале, мессенджер приносит неразрывные
   пробелы, человек разделяет слова запятыми или переносами. Всё это про
   вид, а не про содержание, и отвергать из-за этого кошелёк нельзя. */
const dressed = [
  ['заглавные буквы', WORDS.map((w, i) => i % 3 ? w : w[0].toUpperCase() + w.slice(1)).join(' ')],
  ['ВСЁ ЗАГЛАВНЫМИ', GOOD.toUpperCase()],
  ['запятые между словами', WORDS.join(', ')],
  ['переводы строк', WORDS.join('\n')],
  ['двойные пробелы и отступы', '   ' + WORDS.join('  ') + '  '],
];
for (const [name, text] of dressed){
  R.ok('фраза с «' + name + '» принимается', (await problem(text)) === null,
    String(await problem(text)));
}

// ---------- не то число слов ----------
let p = await problem(WORDS.slice(0, 11).join(' '));
R.ok('ПРО ЧИСЛО СЛОВ СКАЗАНО ЧИСЛОМ, А НЕ «ОШИБКА»',
  /11/.test(p || ''), String(p));
p = await problem(WORDS.concat(WORDS[0]).join(' '));
R.ok('и лишнее слово тоже названо числом', /13/.test(p || ''), String(p));

// ---------- слова нет в списке ----------
/* Ровно тот случай, на котором это и всплыло: одна буква не та. */
const typo = WORDS.slice();
typo[7] = 'fanch';                       // в списке есть ranch, а fanch нет
p = await problem(typo.join(' '));
R.ok('НЕИЗВЕСТНОЕ СЛОВО НАЗВАНО ПОИМЁННО', /fanch/i.test(p || ''), String(p).slice(0, 110));
R.ok('И ПРЕДЛОЖЕНО ПОХОЖЕЕ ИЗ СПИСКА', /ranch/i.test(p || ''), String(p).slice(0, 130));

/* Заглавная буква не должна превращать годное слово в негодное: именно так
   телефон и портит первое слово строки. */
const capped = WORDS.slice();
capped[3] = capped[3][0].toUpperCase() + capped[3].slice(1);
R.ok('заглавная буква сама по себе слово не ломает',
  (await problem(capped.join(' '))) === null, String(await problem(capped.join(' '))));

/* Несколько неизвестных слов — называются все (до трёх), а не первое. */
const two = WORDS.slice();
two[2] = 'zzzq'; two[9] = 'qqzz';
p = await problem(two.join(' '));
R.ok('называются оба непонятных слова, а не одно',
  /zzzq/.test(p || '') && /qqzz/.test(p || ''), String(p).slice(0, 120));

// ---------- слова годные, а фраза нет ----------
/* Слова все из списка, но порядок другой. Контрольная сумма это ловит, и
   человеку надо сказать именно про порядок: искать «неправильное слово» он
   будет впустую. */
const shuffled = WORDS.slice();
const tmp = shuffled[0]; shuffled[0] = shuffled[1]; shuffled[1] = tmp;
R.ok('перестановка слов сама по себе не считается неизвестным словом',
  (await problem(shuffled.join(' '))) === null);

const importErr = async (text) => page.evaluate(async (x) => {
  document.getElementById('importSeedInput').value = x;
  const box = document.getElementById('importError');
  box.classList.add('hidden'); box.textContent = '';
  await doImport();
  return box.classList.contains('hidden') ? null : box.textContent;
}, text);

/* Приложение до этого места ещё не настроено (кошелька нет), поэтому
   доводим до экрана ввода так же, как это делает человек. */
await page.evaluate(() => { chooseRole('buyer'); });
await page.evaluate(() => { flowStage = 'setup'; renderWalletState(); });
await page.evaluate(() => {
  document.getElementById('importSeedBlock').classList.remove('hidden');
});

p = await importErr(shuffled.join(' '));
R.ok('ПРО ПЕРЕПУТАННЫЙ ПОРЯДОК СКАЗАНО СЛОВАМИ',
  /порядок/i.test(p || ''), String(p).slice(0, 120));
R.ok('И СЛОВА «INVALID MNEMONIC» ЧЕЛОВЕК НЕ ВИДИТ',
  !/invalid mnemonic/i.test(p || ''), String(p).slice(0, 60));

p = await importErr(typo.join(' '));
R.ok('а опечатка и на экране названа поимённо',
  /fanch/i.test(p || '') && !/invalid mnemonic/i.test(p || ''), String(p).slice(0, 120));

// ---------- фраза никуда не уходит ----------
/* Разбор обязан быть местным. Если бы слова уезжали на чей-то сервер за
   подсказкой, это была бы худшая утечка из возможных. */
const out = [];
page.on('request', r => { if (!/^http:\/\/localhost:8(099|555)/.test(r.url())) out.push(r.url()); });
await problem(typo.join(' '));
await importErr(typo.join(' '));
await page.waitForTimeout(500);
R.ok('НИ ОДНО СЛОВО ФРАЗЫ НИКУДА НЕ ОТПРАВЛЯЕТСЯ',
  out.length === 0, out.join(' ').slice(0, 90) || 'запросов наружу нет');

const clean = errors.filter(x => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(x));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
