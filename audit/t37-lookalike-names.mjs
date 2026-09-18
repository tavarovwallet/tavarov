/* Имена, выдающие себя за официальные.

   В контракте закрыты точные слова: занять support, binance или tavarov
   нельзя никому. Но список закрывает ТОЧНЫЕ написания, а мошеннику хватит
   похожего: supporttavarov, tavarov_help2, binance_pay, usdt_bonus.
   Перебрать все написания невозможно — их бесконечно много.

   Поэтому вторая половина защиты живёт в приложении: если в имени
   получателя встречается знакомый корень, человеку говорят об этом прямо
   перед отправкой. Не запрещают — предупреждают: иметь имя со словом
   support внутри никому не запрещено, а вот считать такое имя
   удостоверением нельзя.

   И обратная сторона, не менее важная: предупреждение, которое срабатывает
   на честных именах, через неделю перестают читать. Поэтому здесь
   проверяется и то, что обычные имена проходят молча. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });

// ---------- сам разбор ----------
const root = (name) => page.evaluate(n => lookalikeRoot(n), name);

for (const [name, expect] of [
  ['supporttavarov', 'tavarov'],
  ['tavarov_help2',  'tavarov'],
  ['binance_pay',    'binance'],
  ['usdt_bonus',     'usdt'],
  ['metamask2',      'metamask'],
  ['official_shop',  'official'],
  ['seedphrase_help','seedphrase'],
  ['airdrop2026',    'airdrop'],
]){
  R.ok('«' + name + '» распознаётся как похожее на официальное',
    (await root(name)) === expect, String(await root(name)));
}

/* Честные имена обязаны проходить молча. Ложное срабатывание здесь хуже
   пропуска: оно приучает не читать предупреждения вообще. */
for (const name of ['kofeinya', 'anna', 'market_7', 'coffee_shop', 'ivan', 'taxi_nsk', 'barbershop']){
  R.ok('«' + name + '» проходит молча', (await root(name)) === '', String(await root(name)));
}

/* Первое, что делает мошенник, увидев проверку по словам, — рассыпает слово
   разделителями: tav_arov, s_u_p_p_o_r_t. Поэтому перед сравнением из имени
   выбрасывается всё, кроме букв и цифр: человек читает «tav_arov» как
   «таваров», и проверка обязана читать так же. */
R.ok('ПОДЧЁРКИВАНИЯ ВНУТРИ СЛОВА НЕ ПРЯЧУТ КОРЕНЬ',
  (await root('tav_arov')) === 'tavarov' && (await root('s_u_p_p_o_r_t')) === 'support',
  (await root('tav_arov')) + ' / ' + (await root('s_u_p_p_o_r_t')));

// ---------- перевод по имени ----------
/* Живой путь: человек ввёл имя получателя, приложение спросило контракт и
   собирается сказать «переводим такому-то». */
const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 1, USDT: 100, TVR: 0 };
state.names['supporttavarov'] = '0x2222222222222222222222222222222222222222';
state.names['kofeinya']       = '0x3333333333333333333333333333333333333333';

const typeName = async (name) => {
  await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
  await page.waitForTimeout(300);
  await page.fill('#sendTo', name);
  await page.evaluate(n => resolveName(n, n), name);
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const b = document.getElementById('scanIntentBox');
    return { text: b.textContent, warn: b.className.indexOf('notice-warn') >= 0,
             hidden: b.classList.contains('hidden') };
  });
};

let r = await typeName('supporttavarov');
R.ok('ПРИ ПЕРЕВОДЕ НА ПОХОЖЕЕ ИМЯ ПОКАЗЫВАЮТ ПРЕДУПРЕЖДЕНИЕ',
  r.warn && !r.hidden, r.text.slice(0, 80));
R.ok('и сказано, что официальным оно не является',
  /не является/.test(r.text), r.text.slice(0, 110));
R.ok('и что фразу мы не спрашиваем никогда',
  /фразу из двенадцати слов/.test(r.text), r.text.slice(-80));
R.ok('и адрес получателя всё равно показан — платить не запрещают',
  /0x22/i.test(r.text) || /…/.test(r.text), r.text.slice(-60));

r = await typeName('kofeinya');
R.ok('А НА ЧЕСТНОМ ИМЕНИ ПРЕДУПРЕЖДЕНИЯ НЕТ', !r.warn, r.text.slice(0, 70));
R.ok('и имя с адресом показаны как обычно', /kofeinya/.test(r.text), r.text.slice(0, 70));

// ---------- название точки из кода ----------
/* Название в коде — свободный текст, его пишет тот, кто код собрал.
   «Tavarov Support» на экране выглядит как удостоверение. */
const scanned = await page.evaluate(async () => {
  const link = buildQrPayload({ to: '0x2222222222222222222222222222222222222222',
                                m: '0x2222222222222222222222222222222222222222',
                                cur: 'USDT', amt: '50', name: 'Tavarov Support', inv: newInvoiceId() });
  await applyScannedPayment(link);
  const b = document.getElementById('scanIntentBox');
  return { text: b.textContent, warn: b.className.indexOf('notice-warn') >= 0 };
});
R.ok('НАЗВАНИЕ ТОЧКИ, ВЫДАЮЩЕЕ СЕБЯ ЗА НАС, ТОЖЕ ПОМЕЧЕНО',
  scanned.warn && /не является/.test(scanned.text), scanned.text.slice(0, 90));

const honest = await page.evaluate(async () => {
  const link = buildQrPayload({ to: '0x3333333333333333333333333333333333333333',
                                m: '0x3333333333333333333333333333333333333333',
                                cur: 'USDT', amt: '50', name: 'Кофейня на углу', inv: newInvoiceId() });
  await applyScannedPayment(link);
  const b = document.getElementById('scanIntentBox');
  return { text: b.textContent, warn: b.className.indexOf('notice-warn') >= 0 };
});
R.ok('а честная точка помечена не бывает', !honest.warn, honest.text.slice(0, 70));

/* Список официальных имён пуст — и это правда: ни одного официального
   имени мы пока никому не выдали. Когда выдадим, они перестанут помечаться
   предупреждением, и это надо будет делать осознанно. */
R.ok('список официальных имён пуст, и предупреждение честно',
  (await page.evaluate(() => OFFICIAL_NAMES.length)) === 0);

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
