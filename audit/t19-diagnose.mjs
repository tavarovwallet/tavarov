/* Разбор поломки приёма оплаты.

   Написано по живому случаю. Продавец несколько дней подряд говорил «приёмник
   не работает», а приложение отвечало одной строчкой «не получилось». Причин у
   этой строчки шесть, лечатся они по-разному, и выяснять их приходилось
   перепиской: какая сборка, какая сеть, что дословно на экране.

   Теперь приложение выясняет это само. Здесь проверяется, что оно не врёт ни в
   одном из шести случаев — и, что важнее, не выдаёт молчание узла сети за
   поломку кассы. */
import { boot, reporter } from './boot.mjs';
import { start, state } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'seller', testnet: true, rpc: 'http://localhost:8555' });

const me = await page.evaluate(() => wallet.evm.address);
state.balances[me.toLowerCase()] = { native: 0.5, USDT: 10, TVR: 0 };

const run = async () => {
  await page.evaluate(() => { tab = 'pay'; setPayMode('kassa'); });
  await page.evaluate(() => diagnoseVault());
  await page.waitForFunction(() => !vaultDiagBusy, null, { timeout: 40000 });
  return page.evaluate(() => ({
    list: document.getElementById('vaultDiagList').textContent,
    verdict: document.getElementById('vaultDiagVerdict').textContent,
    warn: document.getElementById('vaultDiagVerdict').className.indexOf('notice-warn') >= 0,
    shown: !document.getElementById('vaultDiagCard').classList.contains('hidden')
  }));
};

// ---------- всё в порядке, приёмника ещё нет ----------
let r = await run();
R.ok('разбор открывается', r.shown);
R.ok('видна сборка приложения', /Сборка приложения: 20\d\d-\d\d-\d\d/.test(r.list),
  (r.list.match(/Сборка[^\n]*/) || [''])[0]);
R.ok('видна сеть', /Сеть: /.test(r.list));
R.ok('виден адрес продавца', r.list.includes(me), (r.list.match(/Ваш адрес[^\n]*/) || [''])[0]);
R.ok('видно, сколько есть на комиссию', /На комиссию сети есть: 0\.5/.test(r.list),
  (r.list.match(/На комиссию[^\n]*/) || [''])[0]);
R.ok('помех не найдено — так и сказано', /Помех не видно/.test(r.verdict), r.verdict.slice(0, 60));
R.ok('и это не тревожное сообщение', !r.warn);

// ---------- никаких приёмников: их больше нет ----------
R.ok('слова «приёмник» в разборе не осталось',
  !/[Пп]риёмник/.test(r.list + r.verdict), (r.list.match(/[^\n]*риёмник[^\n]*/) || [''])[0]);
R.ok('сказано, что касса готова', /касса готова принимать оплату/.test(r.verdict), r.verdict.slice(0, 60));

// ---------- нет монеты на комиссию ----------
state.balances[me.toLowerCase()] = { native: 0, USDT: 10, TVR: 0 };
r = await run();
R.ok('НЕХВАТКА МОНЕТЫ СЕТИ НАЗВАНА ПРЯМО',
  /платить за запись в блокчейн нечем/.test(r.list), (r.list.match(/На кошельке[^\n]*/) || [''])[0]);
R.ok('сказано, сколько положить', /Пополните этот кошелёк на 0\.002/.test(r.verdict), r.verdict.slice(0, 80));
R.ok('и это тревожное сообщение', r.warn);
R.ok('про поломку контракта при этом ни слова', !/условие внутри контракта/.test(r.verdict + r.list));
state.balances[me.toLowerCase()] = { native: 0.5, USDT: 10, TVR: 0 };

// ---------- в сборке нет адресов ----------
await page.evaluate(() => { CONTRACTS.bnbTestnet.pay = null; CONTRACTS.bnbTestnet.token = null; });
r = await run();
R.ok('СТАРАЯ СБОРКА БЕЗ АДРЕСОВ УЗНАЁТСЯ',
  /В этой сборке нет адресов контрактов/.test(r.list));
R.ok('и сказано, что делать', /Обновите страницу|выложите свежую сборку/.test(r.verdict), r.verdict.slice(0, 70));

// ---------- узел сети молчит ----------
await page.evaluate(() => {
  CONTRACTS.bnbTestnet.pay   = '0x3A3Ba9776ea9c48AE6C69Ae6153d9bBc892ed6e6';
  CONTRACTS.bnbTestnet.token = '0x74536e79b374CCFa0123035B28f7a3b7333f323a';
  TESTNET.bnb.rpc = 'http://localhost:8599'; TESTNET.bnb.rpcs = ['http://localhost:8599'];
  /* провайдеры кэшируются по адресу узла, новый адрес — новый провайдер */
});
r = await run();
R.ok('МОЛЧАНИЕ УЗЛА НЕ ВЫДАЁТСЯ ЗА ПОЛОМКУ КАССЫ',
  /Узел сети не отвечает/.test(r.list), (r.list.match(/Узел[^\n]*/) || [''])[0]);
R.ok('и сказано, что касса тут ни при чём',
  /не поломка кассы/.test(r.verdict), r.verdict.slice(0, 70));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED|8599|ECONNREFUSED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
