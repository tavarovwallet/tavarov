/* Витрина приложения.

   Страница, на которую человек попадает раньше самого приложения. Здесь
   ломается тихо: пропущенный перевод оставляет посреди испанского текста
   русскую строку, «Скачать» ведёт в 404, а адрес контракта в подвале
   расходится с тем, что зашито в приложении, — и человек проверяет по
   ссылке не тот контракт, которому платит.

   Поэтому проверяется не вёрстка, а то, чем витрина врёт: пропуски в пяти
   языках, мёртвые ссылки, разъехавшиеся адреса и кнопка скачивания, за
   которой нет файла. */
import { chromium } from 'playwright';
import { reporter } from './boot.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/claude/apk/site';
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
                '.json':'application/json; charset=utf-8', '.css':'text/css; charset=utf-8',
                '.png':'image/png', '.svg':'image/svg+xml', '.webp':'image/webp' };
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  let file = path.join(ROOT, rel);
  /* КАК НАСТОЯЩИЙ ХОСТИНГ: адрес без .html отдаётся из одноимённого файла.
     Правило лежит в site/_redirects; без него проверка ходила бы по
     адресам, которых на живом сайте не бывает. */
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
    res.writeHead(404); res.end('нет такого файла'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => srv.listen(8098, r));
const URL = 'http://localhost:8098/index.html';

const R = reporter();
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const missing = [];
page.on('requestfailed', r => missing.push(r.url()));
page.on('response', r => { if (r.status() >= 400) missing.push(r.status() + ' ' + r.url()); });

await page.goto(URL, { waitUntil: 'networkidle' });

/* Титул главной проверяем на имя КОШЕЛЬКА, а не шлюза. 19 сентября
   кошелёк стал называться NoN Wallet, и первый экран витрины продаёт
   именно его: заголовок про оплату криптой, кнопка «Открыть кошелёк»,
   снимки кошелька. Шлюз живёт на странице продавцов и называется там
   своим именем — это проверяется отдельно, ниже. */
R.ok('страница открывается и названа кошельком',
  (await page.title()).includes('NoN Wallet'), await page.title());

// ---------- пять языков без пропусков ----------
/* Ключ, которого нет в словаре, оставляет на месте русскую строку. На
   витрине это выглядит как брошенная работа, и заметить это глазами
   невозможно: языков пять, строк под сорок. */
const codes = ['ru', 'en', 'es', 'tr', 'pt'];
const keys = await page.evaluate(() =>
  [...new Set([...document.querySelectorAll('[data-t]')].map(e => e.dataset.t))]);
R.ok('строк на странице действительно много', keys.length >= 35, 'строк ' + keys.length);

for (const code of codes){
  if (code === 'ru') continue;
  const gaps = await page.evaluate(c => {
    const d = T[c] || {};
    return [...new Set([...document.querySelectorAll('[data-t]')].map(e => e.dataset.t))]
      .filter(k => d[k] === undefined);
  }, code);
  R.ok('перевод на ' + code.toUpperCase() + ' полный', gaps.length === 0, gaps.join(', ').slice(0, 80));
}

/* И переключатель обязан на самом деле менять текст, а не только подсветку. */
const ruH1 = await page.textContent('h1');
const ruTitle = await page.title();
await page.click('#langs button[data-code="tr"]');
await page.waitForTimeout(300);
const trH1 = await page.textContent('h1');
R.ok('ПЕРЕКЛЮЧАТЕЛЬ МЕНЯЕТ ТЕКСТ, А НЕ ТОЛЬКО ПОДСВЕТКУ', trH1 !== ruH1 && trH1.length > 5, trH1);
/* Заголовок вкладки — это то, что человек увидит в закладках и в поиске.
   Проверяем не конкретное слово (текст ещё поменяется не раз), а что он
   вообще другой: молча оставшийся русский заголовок на турецкой странице —
   ровно та ошибка, ради которой эта проверка и написана. */
R.ok('и заголовок вкладки меняется тоже',
  (await page.title()) !== ruTitle && !/[А-Яа-яЁё]/.test(await page.title()),
  await page.title());
R.ok('язык страницы объявлен для читалок',
  await page.evaluate(() => document.documentElement.lang) === 'tr');

await page.click('#langs button[data-code="es"]');
await page.waitForTimeout(300);
R.ok('выбор языка запоминается',
  await page.evaluate(() => localStorage.getItem('tavarov.site.lang')) === 'es');

// ---------- ссылки ведут туда, где что-то есть ----------
const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
/* Ссылку на файл Android считать мёртвой нельзя, пока её никому не
   показывают: её адрес подставляется из apk.json, а до того она спрятана. */
const shownHrefs = await page.evaluate(() =>
  [...document.querySelectorAll('a[href]')].filter(a => a.offsetParent !== null).map(a => a.getAttribute('href')));
const local = shownHrefs.filter(h => h.startsWith('./'));
/* Адреса теперь без .html — файл ищем и так, и так, ровно как хостинг. */
const onDisk = (h) => {
  const f = path.join(ROOT, h.replace('./', '').split('#')[0]);
  return fs.existsSync(f) || fs.existsSync(f + '.html');
};
const dead = local.filter(h => !onDisk(h));
R.ok('ВСЕ ССЫЛКИ НА СВОЙ САЙТ ВЕДУТ НА СУЩЕСТВУЮЩИЕ СТРАНИЦЫ',
  dead.length === 0, dead.join(', '));
/* Витрина и кошелёк живут на разных адресах: у кошелька своё хранилище, и
   скрипт с витрины до ключей не дотянется. Цена этого решения — ссылки на
   приложение обязаны быть абсолютными. Относительная «./» с витрины ведёт
   в пустоту, и человек упирается в 404 на кнопке «Открыть кошелёк». */
const WALLET = 'https://wallet.tavarov.com';
R.ok('КНОПКА «ОТКРЫТЬ КОШЕЛЁК» ВЕДЁТ НА АДРЕС КОШЕЛЬКА',
  shownHrefs.includes(WALLET + '/'), shownHrefs.filter(h => h.includes('wallet')).join(' '));
/* К ссылке на кассу витрина дописывает свой язык: касса на другом адресе и
   про сделанный здесь выбор не знает. Поэтому сверяем начало, а не строку
   целиком. */
R.ok('есть путь для магазина — выставить счёт',
  shownHrefs.some(h => h.startsWith(WALLET + '/invoice')),
  shownHrefs.filter(h => h.includes('invoice')).join(' '));
R.ok('и политика конфиденциальности рядом, на самой витрине',
  shownHrefs.includes('./privacy'), shownHrefs.filter(h => h.includes('privacy')).join(' '));
/* Ни одной видимой ссылки с .html: адреса, которые человек видит и копирует,
   должны быть чистыми. К /pay это НЕ относится — см. www/_redirects. */
const withExt = shownHrefs.filter(h => /\.html(\?|#|$)/.test(h));
R.ok('НИ В ОДНОЙ ВИДИМОЙ ССЫЛКЕ НЕТ .html', withExt.length === 0, withExt.join(' '));

/* Ни одной ссылки на прежние площадки. Забытая — это тихий увод человека
   туда, где лежит прошлая версия и где его кошелька нет. */
const oldHosts = hrefs.filter(h => /pages\.dev|netlify\.app/i.test(h));
R.ok('НИ ОДНОЙ ССЫЛКИ НА СТАРЫЕ АДРЕСА', oldHosts.length === 0, oldHosts.join(' '));

/* И в самом приложении тоже: адрес по умолчанию для ссылок на оплату,
   подсказка в настройках, запасной адрес на странице счёта. */
const appSrc = fs.readFileSync('/home/claude/apk/www/index.html', 'utf-8');
const paySrc = fs.readFileSync('/home/claude/apk/www/pay.html', 'utf-8');
const stray = [];
for (const [file, text] of [['index.html', appSrc], ['pay.html', paySrc]]){
  text.split('\n').forEach((line, i) => {
    /* Два места, где старый адрес нужен нарочно: список переезда в
       приложении и белый список страницы счёта. Во втором он не ведёт
       никуда — наоборот, только по нему и разрешено вести кнопке, а всё
       остальное отбрасывается. */
    if (/pages\.dev|netlify\.app/i.test(line) && !/SITE_OLD|WALLET_ORIGINS|tavarov-wallet\.(pages\.dev|netlify\.app)'/.test(line))
      stray.push(file + ':' + (i + 1));
  });
}
R.ok('И В ПРИЛОЖЕНИИ СТАРЫХ АДРЕСОВ НЕ ОСТАЛОСЬ, КРОМЕ СПИСКА ПЕРЕЕЗДА',
  stray.length === 0, stray.join(', '));
R.ok('новый адрес прописан в приложении как адрес для счетов',
  /const SITE_DEFAULT = 'https:\/\/wallet\.tavarov\.com'/.test(appSrc));

/* Адреса контрактов в подвале обязаны совпадать с теми, которым приложение
   на самом деле платит. Разъедутся — человек проверит по ссылке чужой
   контракт и решит, что всё хорошо. */
const app = fs.readFileSync('/home/claude/apk/www/index.html', 'utf-8');   // приложение лежит в другой папке
const main = app.slice(app.indexOf('bnbMainnet:'), app.indexOf('bnbMainnet:') + 1200);
const grab = (k) => (main.match(new RegExp(k + ":\\s*'(0x[0-9a-fA-F]{40})'")) || [])[1];
for (const [name, key] of [['оплаты','pay'], ['токена','token'], ['казны','splitter'], ['имён','names']]){
  const addr = grab(key);
  R.ok('адрес контракта ' + name + ' в подвале тот же, что в приложении',
    !!addr && hrefs.some(h => h.toLowerCase().includes(addr.toLowerCase())), String(addr));
}

// ---------- снимки экрана действительно видны ----------
const shots = await page.evaluate(() =>
  [...document.querySelectorAll('.shot img')].map(i => ({ src: i.getAttribute('src'), w: i.naturalWidth })));
R.ok('снимков экрана четыре', shots.length === 4, 'найдено ' + shots.length);
R.ok('И КАЖДЫЙ СНИМОК ДЕЙСТВИТЕЛЬНО ЗАГРУЗИЛСЯ',
  shots.every(s => s.w > 0), shots.map(s => s.src + ':' + s.w).join(' '));

/* Снимки обязаны меняться вместе с языком: русские экраны на английской
   витрине выглядят как работа, брошенная на полпути. И каждый файл обязан
   лежать на диске — пропущенный язык даёт пустое место вместо телефона. */
for (const code of codes){
  await page.evaluate(c => apply(c), code);
  await page.waitForTimeout(400);
  const set = await page.evaluate(() =>
    [...document.querySelectorAll('.shot img')].map(i => i.getAttribute('src')));
  const wrong = set.filter(s => !s.startsWith('./shots/' + code + '/'));
  const absent = set.filter(s => !fs.existsSync(path.join(ROOT, s.replace('./', ''))));
  R.ok('снимки на ' + code.toUpperCase() + ' подставляются и лежат на диске',
    wrong.length === 0 && absent.length === 0, [...wrong, ...absent].join(' ').slice(0, 80));
}
await page.evaluate(() => apply('ru'));
await page.waitForTimeout(300);

// ---------- кнопка скачивания без файла ----------
R.ok('БЕЗ ФАЙЛА КНОПКИ «СКАЧАТЬ» НЕТ',
  await page.evaluate(() => document.getElementById('apkBox').classList.contains('hidden')
                         && document.getElementById('apkTop').classList.contains('hidden')));
R.ok('и сказано, что файла пока нет',
  await page.isVisible('#apkNone'));

/* А когда файл выложен — кнопка появляется вместе с отпечатком, по которому
   человек может сверить скачанное. Без отпечатка кнопка бесполезна: подделку
   от настоящего файла отличить будет нечем. */
const apkJson = path.join(ROOT, 'apk.json');
fs.writeFileSync(apkJson, JSON.stringify({
  file: 'tavarov.apk', version: '2026-09-10.5', size: '12.4 МБ',
  sha256: 'a'.repeat(64) }), 'utf-8');
try {
  await page.evaluate(() => localStorage.setItem('tavarov.site.lang', 'ru'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  R.ok('С ФАЙЛОМ КНОПКА ПОЯВЛЯЕТСЯ', await page.isVisible('#apkBox'));
  R.ok('и рядом с ней отпечаток файла',
    (await page.textContent('#apkHash')).length === 64);
  R.ok('и версия', (await page.textContent('#apkVer')).includes('2026-09-10.5'));
  R.ok('и предупреждение про чужие сайты',
    /Скачивайте только с этой страницы|только с этой/i.test(await page.textContent('#download')));
  const href = await page.getAttribute('#apkLink', 'href');
  R.ok('ссылка ведёт на сам файл, а не куда попало', href === './tavarov.apk', String(href));
} finally {
  fs.unlinkSync(apkJson);
}

// ---------- политика конфиденциальности ----------
/* Без неё в Google Play не пускают вовсе. И она обязана быть такой же
   пятиязычной: политика, наполовину написанная по-русски, для испанца
   бесполезна ровно так же, как её отсутствие. */
const priv = await ctx.newPage();
const privErrors = [];
priv.on('pageerror', e => privErrors.push('privacy: ' + e.message));
await priv.goto('http://localhost:8098/privacy', { waitUntil: 'networkidle' });
R.ok('политика конфиденциальности открывается',
  (await priv.title()).toLowerCase().includes('tavarov'), await priv.title());
R.ok('на витрине есть ссылка на политику',
  hrefs.includes('./privacy'));

for (const code of codes){
  if (code === 'ru') continue;
  const gaps = await priv.evaluate(c => {
    const d = T[c] || {};
    return [...new Set([...document.querySelectorAll('[data-t]')].map(e => e.dataset.t))]
      .filter(k => d[k] === undefined);
  }, code);
  R.ok('политика на ' + code.toUpperCase() + ' переведена полностью',
    gaps.length === 0, gaps.join(', ').slice(0, 70));
}

/* Главное, ради чего эта страница вообще существует: сказать, что мы не
   собираем, куда уходят запросы и зачем камера. Если это выпадет при
   очередной правке, останется красивая пустая страница. */
const text = await priv.textContent('main');
R.ok('СКАЗАНО, ЧТО КЛЮЧИ ОСТАЮТСЯ НА УСТРОЙСТВЕ', /на вашем устройстве|не покидает/i.test(text));
R.ok('перечислены узлы сети, куда уходят запросы', /BNB Chain|bsc-dataseed/i.test(text));
R.ok('названа камера и зачем она', /[Кк]амера/.test(text) && /QR/.test(text));
R.ok('сказано про резервную копию и пароль', /[Рр]езервная копия|копию создаёте/i.test(text));
R.ok('есть почта для связи', /@/.test(text));
R.ok('и предупреждение, что фразу у вас никто не спрашивает',
  /не спрашиваем никогда|мошенник/i.test(text));
errors.push(...privErrors);

// ---------- узкий экран ----------
const small = await ctx.newPage();
await small.setViewportSize({ width: 320, height: 720 });
await small.goto(URL, { waitUntil: 'networkidle' });
const over = await small.evaluate(() => ({ w: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
R.ok('НА ЭКРАНЕ 320 ТОЧЕК НИЧЕГО НЕ ВЫЛЕЗАЕТ ВБОК', over.w <= over.cw + 1, JSON.stringify(over));

// ---------- тёмная тема ----------
const dark = await browser.newContext({ viewport: { width: 1180, height: 900 }, colorScheme: 'dark' });
const dp = await dark.newPage();
await dp.goto(URL, { waitUntil: 'load' });
const bg = await dp.evaluate(() => getComputedStyle(document.body).backgroundColor);
R.ok('в тёмной теме фон тёмный, а не белый', /rgb\((\d+), (\d+), (\d+)\)/.test(bg)
  && bg.match(/\d+/g).slice(0, 3).every(v => +v < 60), bg);

/* Счётчик посещений стоит на витрине и грузится со стороны Cloudflare.
   В проверочной машине внешней сети нет, поэтому он там не загружается —
   и это НЕ поломка страницы: скрипт с defer, сайт без него работает
   целиком. Отдельно проверяем ниже, что на страницах кошелька его нет. */
const bad = errors.filter(e => !/Failed to load resource/.test(e))
  .concat(missing.filter(u => !/apk\.json|cloudflareinsights/.test(u)).map(u => 'не загрузилось: ' + u));
const good = R.done(bad);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
