/* История операций.

   Живая история, из-за которой это всё и переписано. Человек платил, платёж
   уходил, деньги приходили — а в истории было пусто. Причина оказалась
   арифметической: историю мы собирали из событий за последние 5000 блоков, а
   блок в BNB Chain идёт 0.45 секунды. Пять тысяч блоков — это тридцать семь
   минут. Через час своя же оплата исчезала из списка, и приложение уверенно
   писало «пока нет транзакций».

   Глубже спросить было нельзя: публичный узел на блоки старше примерно часа
   отвечает «нужен личный токен». Поэтому теперь приложение ведёт собственный
   журнал: свою операцию записывает сразу и навсегда, а из сети добирает
   входящие переводы, которых знать не может.

   Здесь проверяется главное свойство этого журнала: запись не должна
   пропадать, когда сеть о ней забыла. */
import { boot, reporter, answerTotp } from './boot.mjs';
import { start, state, transferLog, ADDR } from './mocknode.mjs';

const srv = await start(8555);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8555' });

const me = await page.evaluate(() => wallet.evm.address);
const FRIEND = '0x2222222222222222222222222222222222222222';
state.balances[me.toLowerCase()] = { native: 1, USDT: 100, TVR: 0 };

const view = async () => {
  await page.evaluate(() => { tab = 'history'; renderWalletState(); });
  await page.evaluate(() => loadHistory());
  await page.waitForTimeout(2500);
  return page.evaluate(() => ({
    text: document.getElementById('historyList').innerText,
    rows: document.querySelectorAll('#historyList .tx-item').length,
    note: document.getElementById('historyNote').textContent,
    noteShown: !document.getElementById('historyNote').classList.contains('hidden'),
    journal: (JSON.parse(localStorage.getItem('tavarov.hist.v1') || '[]')).length
  }));
};

// ---------- в списке есть кнопка в обозреватель ----------
await page.evaluate(() => { tab = 'history'; renderWalletState(); });
await page.waitForTimeout(400);
R.ok('рядом с историей есть выход в обозреватель',
  await page.evaluate(() => typeof openHistoryExplorer === 'function' &&
    !!document.querySelector('#historyCard button[onclick*="openHistoryExplorer"]')));

// ---------- отправляем перевод ----------
await page.evaluate(() => { tab = 'pay'; setPayMode('transfer'); });
await page.waitForTimeout(400);
await page.fill('#sendTo', FRIEND);
await page.fill('#sendAmount', '7');
await page.selectOption('#sendCurrency', 'USDT');
await page.evaluate(() => renderWalletState());
await page.waitForTimeout(300);
await page.evaluate(() => reviewSend());
await page.waitForTimeout(600);
page.evaluate(() => doSend());
await answerTotp(page, 8000);
await page.waitForTimeout(9000);

const sentTx = state.sent[state.sent.length - 1];
R.ok('перевод действительно ушёл', !!sentTx, String(state.sent.length));

/* Сеть о нём ещё «не знает» — событий нет вовсе. Именно так выглядят первые
   секунды после оплаты, и именно тут человек смотрит в историю. */
state.logs = [];
let v = await view();
R.ok('СВОЯ ОПЕРАЦИЯ ВИДНА СРАЗУ, ДО ОТВЕТА СЕТИ', v.rows >= 1 && /7 USDT/.test(v.text),
  v.text.replace(/\n/g, ' ').slice(0, 90));
R.ok('и записана в журнал, а не только нарисована', v.journal === 1, String(v.journal));
R.ok('видно, что это перевод, а не покупка', /Перевод/.test(v.text),
  v.text.replace(/\n/g, ' ').slice(0, 90));
/* Адрес показываем укороченным: сорок знаков в строке списка не читает
   никто, а начало и хвост человек с чужим адресом сверяет глазами. */
R.ok('видно, кому', /кому 0x2222…2222/.test(v.text), v.text.replace(/\n/g, ' ').slice(0, 90));
R.ok('видно, когда', /сегодня \d\d:\d\d/.test(v.text), (v.text.match(/сегодня[^\n]*/) || [''])[0]);

// ---------- сеть вспомнила ту же операцию ----------
state.logs = [transferLog({ token: ADDR.usdt, from: me, to: FRIEND, amount: '7', decimals: 6,
                            block: state.block - 10, hash: sentTx.hash })];
v = await view();
R.ok('ОДНА ОПЕРАЦИЯ — ОДНА СТРОКА, А НЕ ДВЕ', v.rows === 1, 'строк ' + v.rows);

// ---------- прошёл час: сеть о ней забыла ----------
state.logs = [];
state.block += 9000;
v = await view();
R.ok('ЧЕРЕЗ ЧАС ЗАПИСЬ НЕ ПРОПАДАЕТ', v.rows >= 1 && /7 USDT/.test(v.text),
  v.text.replace(/\n/g, ' ').slice(0, 90));

// ---------- входящий перевод берём из сети ----------
state.logs = [transferLog({ token: ADDR.usdt, from: FRIEND, to: me, amount: '2.5', decimals: 6,
                            block: state.block - 5, hash: '0x' + 'ab'.repeat(32) })];
v = await view();
R.ok('ВХОДЯЩИЙ ПЕРЕВОД ВИДЕН', /\+2\.5 USDT/.test(v.text), v.text.replace(/\n/g, ' ').slice(0, 100));
R.ok('и он сложен со своими, а не вместо них', v.rows === 2, 'строк ' + v.rows);
R.ok('сказано, за какой срок сеть помнит', v.noteShown && /Сеть помнит/.test(v.note), v.note);

/* Сумма и знаки. Шесть знаков у тестового USDT против восемнадцати у
   настоящего — место, где ошибка выглядит как «пришло в миллион раз больше». */
R.ok('СУММА ВХОДЯЩЕГО РАЗОБРАНА ВЕРНО, БЕЗ СДВИГА ЗНАКОВ',
  !/2500000|0\.0000025/.test(v.text), v.text.replace(/\n/g, ' ').slice(0, 100));

// ---------- сеть молчит совсем ----------
const good = state.logs;
await page.evaluate(() => { TESTNET.bnb.rpc = 'http://localhost:8599'; TESTNET.bnb.rpcs = ['http://localhost:8599']; });
v = await view();
R.ok('УЗЛЫ МОЛЧАТ — СВОИ ОПЕРАЦИИ ВСЁ РАВНО НА МЕСТЕ', /7 USDT/.test(v.text),
  v.text.replace(/\n/g, ' ').slice(0, 90));
R.ok('и об этом сказано, а не соврано «транзакций нет»',
  v.noteShown && /Сеть не ответила/.test(v.note), v.note);
await page.evaluate(() => { TESTNET.bnb.rpc = 'http://localhost:8555'; TESTNET.bnb.rpcs = ['http://localhost:8555']; });
state.logs = good;

// ---------- покупка помечается покупкой ----------
await page.evaluate(() => { tab = 'pay'; setPayMode('buy'); });
await page.waitForTimeout(400);
await page.fill('#sendTo', FRIEND);
await page.fill('#sendAmount', '4');
await page.selectOption('#sendCurrency', 'USDT');
await page.evaluate(() => renderWalletState());
await page.waitForTimeout(300);
await page.evaluate(() => reviewSend());
await page.waitForTimeout(800);
page.evaluate(() => doSend());
await answerTotp(page, 8000);
await page.waitForTimeout(9000);
state.logs = [];
v = await view();
R.ok('ПОКУПКА В ИСТОРИИ ПОДПИСАНА ПОКУПКОЙ', /Покупка/.test(v.text),
  v.text.replace(/\n/g, ' ').slice(0, 120));

// ---------- журнал привязан к кошельку ----------
const mine = await page.evaluate(() => histFor(network, wallet.evm.address).length);
const alien = await page.evaluate(() => histFor(network, '0x9999999999999999999999999999999999999999').length);
R.ok('свои записи видит только свой кошелёк', mine >= 2 && alien === 0, mine + ' / ' + alien);
const otherNet = await page.evaluate(() => histFor('polygon', wallet.evm.address).length);
R.ok('и только своя сеть', otherNet === 0, String(otherNet));

// ---------- журнал не растёт бесконечно ----------
await page.evaluate(() => {
  const list = [];
  for (let i = 0; i < 400; i++) list.push({ net: network, own: wallet.evm.address.toLowerCase(),
    hash: '0xff' + String(i), ts: Date.now() - i * 1000, isIn: false, amt: '1', sym: 'USDT', addr: '0x1', kind: 'transfer' });
  histSave(list);
});
R.ok('ЖУРНАЛ НЕ РАСТЁТ БЕСКОНЕЧНО',
  await page.evaluate(() => histAll().length) <= 300,
  String(await page.evaluate(() => histAll().length)));

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED|8599|ECONNREFUSED/i.test(e));
const goodRun = R.done(clean);
await browser.close(); srv.close();
process.exit(goodRun ? 0 : 1);
