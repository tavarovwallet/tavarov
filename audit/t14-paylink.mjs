/* Оплата по ссылке из интернет-магазина.
   Магазин присылает человека ссылкой ...?pay=tavarov:pay?…
   Проверяем три вещи, каждая из которых стоит денег, если сломается:
     - сумма и товар подставились сами, переписывать руками нечего;
     - ссылка исчезла из адресной строки, а не осталась в истории;
     - если кошелёк заперт, ссылка не потерялась, а дождалась пароля. */
import { boot, reporter, answerTotp, unlock, URL as APP } from './boot.mjs';
import { start, state } from './mocknode.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = (require('/home/claude/apk/www/lib/ethers.umd.min.js')).ethers
       || require('/home/claude/apk/www/lib/ethers.umd.min.js');

const srv = await start(8556);
const R = reporter();
const { browser, page, errors } = await boot({ role: 'buyer', testnet: true, rpc: 'http://localhost:8556' });

const SHOP = '0x9911223344556677889900aabbccddeeff001122';
const INV = '0x' + 'ab12'.repeat(16);          // номер заказа в магазине
const LINK = 'tavarov:pay?to=' + SHOP + '&net=bnb&m=' + SHOP +
             '&cur=USDT&amt=12.34&item=' + encodeURIComponent('Кроссовки, размер 42') +
             '&name=' + encodeURIComponent('Магазин «Пример»') + '&inv=' + INV;
const URL_WITH = APP + '?pay=' + encodeURIComponent(LINK);

/* После каждой перезагрузки страницы подменяем узел сети заново: она же
   загружается с нуля и про наш местный узел ничего не помнит. */
async function useMockNode(){
  await page.evaluate(u => { TESTNET.bnb.rpc = u; TESTNET.bnb.rpcs = [u];
                             MAINNET.bnb.rpc = u; MAINNET.bnb.rpcs = [u]; },
                      'http://localhost:8556');
}

/* После перезагрузки кошелёк всегда заперт — так и должно быть: ссылка от
   магазина не повод открывать чужой кошелёк. Значит, сначала пароль. */
await page.goto(URL_WITH, { waitUntil: 'load' });
await page.waitForFunction(() => typeof renderWalletState === 'function');
await useMockNode();
await page.waitForTimeout(600);
R.ok('ссылка сама по себе кошелёк не открывает', await page.isVisible('#lockCard'));
await unlock(page);
await page.waitForTimeout(3000);

R.ok('открылся экран отправки', await page.evaluate(() => tab === 'pay' && actionTab === 'send'));
R.ok('СУММА ПОДСТАВИЛАСЬ', (await page.inputValue('#sendAmount')) === '12.34',
  await page.inputValue('#sendAmount'));
R.ok('валюта подставилась', (await page.evaluate(() => document.getElementById('sendCurrency').value)) === 'USDT');
R.ok('получатель подставился',
  (await page.inputValue('#sendTo')).toLowerCase() === SHOP.toLowerCase(),
  await page.inputValue('#sendTo'));

const note = await page.evaluate(() => document.getElementById('scanIntentBox').textContent);
R.ok('видно, у кого и за что покупаем', /Пример/.test(note) && /Кроссовки/.test(note), note.slice(0, 90));

R.ok('ССЫЛКА УБРАНА ИЗ АДРЕСНОЙ СТРОКИ',
  !(await page.evaluate(() => location.search + location.hash)).includes('pay='),
  await page.evaluate(() => location.search + location.hash));

// ---------- чужую ссылку не подхватываем ----------
await page.goto(APP + '?pay=' + encodeURIComponent('https://злой-сайт.example/'), { waitUntil: 'load' });
await page.waitForFunction(() => typeof renderWalletState === 'function');
await useMockNode();
await page.waitForTimeout(1200);
R.ok('посторонняя ссылка игнорируется',
  await page.evaluate(() => tab !== 'pay' || !document.getElementById('sendTo').value),
  await page.evaluate(() => tab + ' / ' + document.getElementById('sendTo').value));

// ---------- кошелёк заперт: ссылка ждёт пароля ----------
await page.goto(URL_WITH, { waitUntil: 'load' });
await page.waitForFunction(() => typeof renderWalletState === 'function');
await useMockNode();
await page.evaluate(() => { wallet = null; sessionPassword = null; flowStage = 'lock'; renderWalletState(); });
await page.waitForTimeout(500);
R.ok('пока заперто — просят пароль, а не платят', await page.isVisible('#lockCard'));

await unlock(page);
await page.waitForTimeout(3000);
R.ok('после пароля ссылка не потерялась', await page.evaluate(() => tab === 'pay' && actionTab === 'send'));
R.ok('и сумма всё та же', (await page.inputValue('#sendAmount')) === '12.34',
  await page.inputValue('#sendAmount'));

// ---------- платёж по такой ссылке идёт через контракт ----------
state.balances[(await page.evaluate(() => wallet.evm.address)).toLowerCase()] = { native: 1, USDT: 100, TVR: 0 };
state.vaults[SHOP.toLowerCase()] = '0x8888888888888888888888888888888888888888';
await page.evaluate(() => refreshBalances());
await page.waitForTimeout(1500);
await page.evaluate(() => reviewSend());
await page.waitForTimeout(600);
const conf = await page.evaluate(() => document.body.innerText);
R.ok('в подтверждении видно магазин и полный адрес',
  conf.includes(SHOP) || conf.toLowerCase().includes(SHOP.toLowerCase()), '');

/* Главное ради чего всё затевалось: номер счёта магазина должен уйти
   в блокчейн вместе с платежом. Без него магазин не узнает свой заказ. */
state.sent.length = 0;
page.evaluate(() => doSend());
await answerTotp(page);
await page.waitForTimeout(12000);

const iPay = new E.utils.Interface(
  ['function pay(address merchant, address token, uint256 amount, bytes32 invoice)']);
const payTx = state.sent.find(tx => tx.data.startsWith(iPay.getSighash('pay')));
R.ok('платёж ушёл через контракт', !!payTx,
  payTx ? '' : 'отправлено: ' + state.sent.map(tx => tx.data.slice(0, 10)).join(','));

const args = payTx ? iPay.decodeFunctionData('pay', payTx.data) : null;
R.ok('НОМЕР СЧЁТА МАГАЗИНА УШЁЛ В БЛОКЧЕЙН',
  !!args && args[3].toLowerCase() === INV, args ? args[3] : '—');
R.ok('и платим именно магазину',
  !!args && args[0].toLowerCase() === SHOP.toLowerCase(), args ? args[0] : '—');
R.ok('сумма верна', !!args && args[2].toString() === '12340000', args ? args[2].toString() : '—');

const clean = errors.filter(e => !/ERR_TUNNEL|coingecko|Failed to load resource|net::ERR_FAILED/i.test(e));
const good = R.done(clean);
await browser.close(); srv.close();
process.exit(good ? 0 : 1);
