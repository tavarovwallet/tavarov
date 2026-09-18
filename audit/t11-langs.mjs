/* Все пять языков вживую: испанский, турецкий, португальский — экран за
   экраном. Проверяем не «словарь заполнен», а то, что человек на этом
   языке видит слова, а не ключи и не русские остатки. */
import { boot, reporter } from './boot.mjs';
import { start } from './mocknode.mjs';

/* Резервная копия теперь спрашивает код из Authenticator: без этого её можно
   было унести, обойдя разом и порог перевода, и смену пароля. Значит и
   проверке надо его вводить — теми же функциями, что и живому человеку. */
async function passTotp(page){
  const open = await page.evaluate(() =>
    !document.getElementById('totpAskModal').classList.contains('hidden'));
  if (!open) return false;
  await page.evaluate(async () => {
    const code = await totpAt(base32Decode(totpAskSecret), Math.floor(Date.now() / 1000 / 30));
    document.getElementById('totpAskCode').value = code;
    await totpAskSubmit();
  });
  await page.waitForTimeout(400);
  return true;
}


const srv = await start(8557);
const R = reporter();

const { browser, page, errors } = await boot({
  role: 'seller', testnet: true, rpc: 'http://localhost:8557', lang: false
});

const CYR = /[А-Яа-яЁё]/;
const RAWKEY = /\bk[0-9a-f]{8}\b/;

/* Слова, которые остаются кириллицей намеренно: в переключателе языков
   каждый язык подписан на себе самом — испанец должен узнать «Русский»
   в списке, а не читать «Ruso». */
const OK_CYR = ['Русский'];

const LANGS = [
  { code: 'es', name: 'испанский', must: ['Cartera', 'Ajustes'] },
  { code: 'tr', name: 'турецкий',  must: ['Cüzdan', 'Ayarlar'] },
  { code: 'pt', name: 'португальский', must: ['Carteira', 'Ajustes'] }
];

const TABS = ['wallet', 'pay', 'history', 'cashback', 'settings'];

for (const L of LANGS) {
  await page.evaluate(c => setLang(c), L.code);
  await page.waitForTimeout(500);

  R.ok(L.name + ': словарь полный',
    await page.evaluate(c => Object.keys(I18N[c]).length === Object.keys(I18N.ru).length, L.code),
    await page.evaluate(c => Object.keys(I18N[c]).length + ' из ' + Object.keys(I18N.ru).length, L.code));

  R.ok(L.name + ': язык страницы помечен',
    (await page.evaluate(() => document.documentElement.lang)) === L.code);

  for (const tb of TABS) {
    await page.evaluate(t => { tab = t; renderWalletState(); }, tb);
    await page.waitForTimeout(250);
    const txt = await page.evaluate(() => document.body.innerText);
    const cyr = (txt.match(new RegExp('[^\\n]*[А-Яа-яЁё][^\\n]*', 'g')) || [])
      .filter(l => !OK_CYR.some(w => l.includes(w)));
    R.ok(L.name + ' / ' + tb + ': русских слов не осталось', cyr.length === 0,
      cyr.slice(0, 2).join(' | ').slice(0, 100));
    R.ok(L.name + ' / ' + tb + ': ключей вместо надписей нет', !RAWKEY.test(txt),
      (txt.match(RAWKEY) || [''])[0]);
  }

  // самые заметные надписи — на месте
  await page.evaluate(() => { tab = 'wallet'; renderWalletState(); });
  await page.waitForTimeout(250);
  const all = await page.evaluate(() => document.body.innerText);
  R.ok(L.name + ': нижние вкладки переведены', L.must.every(w => all.includes(w)),
    L.must.filter(w => !all.includes(w)).join(', ') || 'все на месте');

  // шторки: их содержимое строится в коде, а не только в разметке
  const SHEETS = [
    ['openTokensSheet', 'closeTokensSheet', 'другие валюты'],
    ['openBackupSheet', 'closeBackupSheet', 'резервная копия'],
    ['openPasswordSheet', 'closePasswordSheet', 'смена пароля'],
    ['openToken', 'closeToken', 'экран токена']
  ];
  for (const [open, close, title] of SHEETS) {
    const has = await page.evaluate(f => typeof window[f] === 'function', open);
    R.ok(L.name + ' / ' + title + ': шторка есть', has);
    if (!has) continue;
    page.evaluate(f => window[f](), open);
    await page.waitForTimeout(600);
    await passTotp(page);
    const s = await page.evaluate(() => document.body.innerText);
    const bad = (s.match(new RegExp('[^\\n]*[А-Яа-яЁё][^\\n]*', 'g')) || [])
      .filter(l => !OK_CYR.some(w => l.includes(w)));
    R.ok(L.name + ' / ' + title + ': без русского и без ключей',
      bad.length === 0 && !RAWKEY.test(s),
      (bad.slice(0, 2).join(' | ') || (s.match(RAWKEY) || [''])[0] || '').slice(0, 90));
    await page.evaluate(f => { try { window[f](); } catch (e) {} }, close);
    await page.waitForTimeout(200);
  }

  await page.screenshot({ path: '/home/claude/apk/audit/shots/язык-' + L.code + '.png', fullPage: true });
}

// возвращаемся к русскому — выбор должен по-прежнему работать в обе стороны
await page.evaluate(() => setLang('ru'));
await page.waitForTimeout(400);
R.ok('обратно на русский переключается',
  (await page.evaluate(() => document.body.innerText)).includes('Кошелёк'));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
